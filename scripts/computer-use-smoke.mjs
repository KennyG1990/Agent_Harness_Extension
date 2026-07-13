import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ComputerUseRunner } from '../out/harness/computerUse.js';
import { Firewall } from '../out/harness/firewall.js';
import { WorkspaceTools } from '../out/harness/tools.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-computer-use-'));
const title = `Forge UIA Fixture ${Date.now()}`;
const fixture = `
Add-Type -AssemblyName PresentationFramework
$window=New-Object System.Windows.Window; $window.Title='${title}'; $window.Width=520; $window.Height=240; $window.WindowStartupLocation='CenterScreen'
$panel=New-Object System.Windows.Controls.StackPanel; $panel.Margin='20'
$box=New-Object System.Windows.Controls.TextBox; $box.Name='ForgeInput'; $box.Height=30; $box.Margin='0,0,0,12'; [System.Windows.Automation.AutomationProperties]::SetName($box,'Forge input')
$button=New-Object System.Windows.Controls.Button; $button.Name='ForgeButton'; $button.Content='Run fixture'; $button.Height=32; $button.Width=130; $button.HorizontalAlignment='Left'; [System.Windows.Automation.AutomationProperties]::SetName($button,'Run fixture')
$label=New-Object System.Windows.Controls.Label; $label.Name='ForgeStatus'; $label.Content='idle'; [System.Windows.Automation.AutomationProperties]::SetName($label,'idle')
$button.Add_Click({$label.Content='clicked'; [System.Windows.Automation.AutomationProperties]::SetName($label,'clicked')})
[void]$panel.Children.Add($box); [void]$panel.Children.Add($button); [void]$panel.Children.Add($label); $window.Content=$panel; [void]$window.ShowDialog()`;
const encoded = Buffer.from(fixture, 'utf16le').toString('base64');
const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', encoded], { windowsHide: false, stdio: 'ignore' });
await new Promise(resolve => setTimeout(resolve, 1500));

try {
  const disabled = new ComputerUseRunner(root, { enabled: false, allowedWindows: [title] });
  const denied = await disabled.inspect({ windowTitle: title, sessionId: 'computer-smoke' });
  assert.equal(denied.success, false);
  assert.match(denied.output, /disabled/);

  const runner = new ComputerUseRunner(root, { enabled: true, allowedWindows: [title] });
  const wrong = await runner.inspect({ windowTitle: 'Not allowlisted', sessionId: 'computer-smoke' });
  assert.equal(wrong.success, false);
  assert.match(wrong.output, /not in forge\.computerUseAllowedWindows/);

  const inspected = await runner.inspect({ windowTitle: title, sessionId: 'computer-smoke' });
  assert.equal(inspected.success, true, inspected.output);
  assert.ok(fs.existsSync(path.join(root, inspected.state.screenshotPath)));
  const button = inspected.state.targets.find(target => target.name === 'Run fixture' && target.patterns.includes('invoke'));
  const textbox = inspected.state.targets.find(target => target.name === 'Forge input' && target.patterns.includes('value'));
  assert.ok(button, 'UIA inspection must expose the fixture invoke target');
  assert.ok(textbox, 'UIA inspection must expose the fixture value target');

  const forged = await runner.act({ stateId: inspected.state.id, action: 'invoke', targetId: 'ct-0000000000000000' });
  assert.equal(forged.success, false);
  const invoked = await runner.act({ stateId: inspected.state.id, action: 'invoke', targetId: button.id });
  assert.equal(invoked.success, true, invoked.output);
  assert.equal(invoked.state.targets.some(target => target.name === 'clicked'), true);
  const replay = await runner.act({ stateId: inspected.state.id, action: 'invoke', targetId: button.id });
  assert.equal(replay.success, false);
  assert.match(replay.output, /missing, stale, or already consumed/);

  const fresh = await runner.inspect({ windowTitle: title, sessionId: 'computer-smoke' });
  const freshTextbox = fresh.state.targets.find(target => target.name === 'Forge input' && target.patterns.includes('value'));
  assert.ok(freshTextbox);
  const entered = await runner.act({ stateId: fresh.state.id, action: 'set_value', targetId: freshTextbox.id, value: 'bounded UIA input' });
  assert.equal(entered.success, true, entered.output);

  const firewall = new Firewall(new WorkspaceTools(root));
  const coordinate = await firewall.validateProposal({ name: 'computer_action', arguments: { stateId: fresh.state.id, action: 'click_at', targetId: freshTextbox.id, x: 10, y: 10 } });
  assert.equal(coordinate.valid, false);
  console.log(JSON.stringify({ passed: true, root, title, stateId: inspected.state.id, targets: inspected.state.targets.length }, null, 2));
} finally {
  child.kill();
}
