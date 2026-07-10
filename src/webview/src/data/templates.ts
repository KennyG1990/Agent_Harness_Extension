import { SandboxTaskTemplate } from '../types';

export const CalculatorTemplate: SandboxTaskTemplate = {
  name: "Calculations: Syntax Typo & Unit Test failures",
  description: "Illustrates self-repair and Reflexion. Contains a syntax typo and a division-by-zero bug. Initially fails compile and test oracles.",
  goal: "Fix the syntax errors in mathUtils.ts, make sure divide handles division by zero safely by returning null, and ensure all unit tests pass.",
  files: {
    "src/mathUtils.ts": {
      path: "src/mathUtils.ts",
      content: `// Utility arithmetic functions
export const add = (a: number, b: number) => {
  return a + b;

export const subtract = (a: number, b: number): number => {
  return a - b;
};

export const divide = (a: number, b: number): number | null => {
  // TODO: Fix division by zero handle
  return a / b;
};
`,
      language: "typescript"
    },
    "tests/mathUtils.test.ts": {
      path: "tests/mathUtils.test.ts",
      content: `import { add, subtract, divide } from '../src/mathUtils';

describe('mathUtils', () => {
  test('adds positive numbers', () => {
    expect(add(2, 3)).toBe(5);
  });

  test('subtracts positive numbers', () => {
    expect(subtract(5, 2)).toBe(3);
  });

  test('handles division by zero safely', () => {
    expect(divide(10, 0)).toBeNull();
  });

  test('divides normal numbers', () => {
    expect(divide(10, 2)).toBe(5);
  });
});
`,
      language: "typescript"
    }
  },
  doneWhen: [
    "Syntax / compiler errors in src/mathUtils.ts are resolved.",
    "divide function handles b = 0 by returning null.",
    "tests/mathUtils.test.ts passes all tests cleanly with 100% coverage."
  ],
  constraints: [
    "Do not import external math libraries (keep vanilla math).",
    "Do not change test assertions inside the test suite."
  ],
  knowledge: {
    ruleFile: "# Math Rules\n- Always return null for divide by zero\n- Do not use parseFloat or parseFloat(eval()) wrappers",
    commandsFile: "npm run lint: tsc --noEmit\nnpm run test: jest tests/mathUtils.test.ts",
    architectureFile: "# Shared Math Module\nPart of core financial calculation pipeline."
  },
  testSuite: {
    run: (files) => {
      const code = files["src/mathUtils.ts"]?.content || "";
      
      // Check for syntax issue (missing closing bracket for add function)
      const matchesOpen = (code.match(/\{/g) || []).length;
      const matchesClose = (code.match(/\}/g) || []).length;
      if (matchesOpen !== matchesClose) {
        return {
          pass: false,
          summary: "Compiler Error: Unexpected end of input",
          details: `src/mathUtils.ts(5,1): error TS1005: '}' expected.
Found ${matchesOpen} opening brackets and only ${matchesClose} absolute closing brackets.`
        };
      }

      // Check if dividing by zero logic is fixed
      const hasDivideByZeroCheck = code.includes("b === 0") || code.includes("b == 0") || code.includes("!b");
      const returnsNull = code.includes("null");
      
      if (!hasDivideByZeroCheck || !returnsNull) {
        return {
          pass: false,
          summary: "Test Suite Failed: mathUtils > handles division by zero safely",
          details: `FAIL  tests/mathUtils.test.ts
  ✕ handles division by zero safely (11ms)
  ✓ adds positive numbers (2ms)
  ✓ subtracts positive numbers (1ms)
  ✓ divides normal numbers (1ms)

  ● mathUtils > handles division by zero safely:
    Expected: null
    Received: Infinity

    At tests/mathUtils.test.ts:13:21`
        };
      }

      return {
        pass: true,
        summary: "All 4 tests passed successfully! (78ms)",
        details: `PASS  tests/mathUtils.test.ts
  ✓ adds positive numbers (4ms)
  ✓ subtracts positive numbers (2ms)
  ✓ handles division by zero safely (3ms)
  ✓ divides normal numbers (2ms)

Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
Snapshots:   0 total
Time:        0.89s`
      };
    }
  }
};

export const StringTemplate: SandboxTaskTemplate = {
  name: "Algorithms: String Manipulation with Reviewer Block",
  description: "Illustrates Subagent Orchestration (Architect -> Editor -> Reviewer). Code must reverse a string without using .reverse() as audited by the Reviewer.",
  goal: "Write a high-performance string reversing utility reverseStr(s: string) in stringHelper.ts, and make sure to pass the reviewer audit.",
  files: {
    "src/stringHelper.ts": {
      path: "src/stringHelper.ts",
      content: `// Reverses a string
export const reverseStr = (s: string): string => {
  // TODO: Implement reversal without using native Array.prototype.reverse()
  return s;
};
`,
      language: "typescript"
    },
    "tests/stringHelper.test.ts": {
      path: "tests/stringHelper.test.ts",
      content: `import { reverseStr } from '../src/stringHelper';

describe('stringHelper', () => {
  test('reverses normal word', () => {
    expect(reverseStr('hello')).toBe('olleh');
  });

  test('handles empty string', () => {
    expect(reverseStr('')).toBe('');
  });

  test('reverses palindromes', () => {
    expect(reverseStr('radar')).toBe('radar');
  });
});
`,
      language: "typescript"
    }
  },
  doneWhen: [
    "reverseStr outputs correct string reversals.",
    "No Array.prototype.reverse() calls exist (enforced by the Reviewer sub-agent!)."
  ],
  constraints: [
    "Do not use native .reverse() or split('').reverse().join('').",
    "Must write a clean iterative or recursive loop."
  ],
  knowledge: {
    ruleFile: "# Code Quality Standards\n- Native array .reverse() is strictly forbidden due to performance overhead.\n- Always write optimal loops.",
    commandsFile: "npm run lint: eslint src/stringHelper.ts\nnpm run test: jest tests/stringHelper.test.ts",
    architectureFile: "# Algorithm Utilities\nPerformance critical module used in batch preprocessing streams."
  },
  testSuite: {
    run: (files) => {
      const code = files["src/stringHelper.ts"]?.content || "";
      
      // Check if it returns empty string instead of reversing
      const isMock = code.includes("return s;") && !code.includes("for") && !code.includes("while");
      if (isMock) {
        return {
          pass: false,
          summary: "Test Suite Failed: stringHelper > reverses normal word",
          details: `FAIL  tests/stringHelper.test.ts
  ✕ reverses normal word (14ms)
  ✓ handles empty string (1ms)
  ✕ reverses palindromes (11ms)

  ● stringHelper > reverses normal word:
    Expected: "olleh"
    Received: "hello"

    At tests/stringHelper.test.ts:5:25`
        };
      }

      // Check if they used .reverse()
      if (code.includes(".reverse(")) {
        return {
          pass: false,
          summary: "Reviewer Audit Failed: Security/Constraint Violation",
          details: `CRITICAL ERROR: Reviewer sub-agent triggered audit failure:
Constraint 'No native .reverse()' violated on line 4 of src/stringHelper.ts.
The model attempted to use Array.prototype.reverse() or String.prototype.reverse, which violates performance norms.
COMMIT BLOCKED.`
        };
      }

      // Check if proper reverse loop is written
      const hasLoop = code.includes("for") || code.includes("while") || code.includes("reduce") || code.includes("reverseStr(");
      if (!hasLoop) {
        return {
          pass: false,
          summary: "Test Suite Failed: Reversal did not run properly",
          details: "Expected loop or recursive function. Output returned empty or unmodified strings."
        };
      }

      return {
        pass: true,
        summary: "All 3 tests passed successfully and Reviewer Audit passed! (64ms)",
        details: `PASS  tests/stringHelper.test.ts
  ✓ reverses normal word (3ms)
  ✓ handles empty string (1ms)
  ✓ reverses palindromes (2ms)

LINTER CODE AUDIT:
  [PASS] Checked src/stringHelper.ts for forbidden .reverse() expressions. None found.`
      };
    }
  }
};

export const Template3_Visual: SandboxTaskTemplate = {
  name: "UI Component: Responsive Glassmorphic Card Layout",
  description: "Illustrates deterministic patch application and framework scope limits. Validates style and responsiveness prior to building.",
  goal: "Design a fully functional modern responsive glassmorphic card component with proper stats grids in card.tsx.",
  files: {
    "src/card.tsx": {
      path: "src/card.tsx",
      content: `import React from 'react';

// Live Stats Card
export const StatsCard = () => {
  return (
    <div className="bg-slate-800 text-white p-4">
      {/* TODO: Upgrade into beautiful Glassmorphic Card layout */}
      <h3>Stats:</h3>
      <p>Tasks Completed: 0</p>
    </div>
  );
};
`,
      language: "tsx"
    }
  },
  doneWhen: [
    "Glassmorphism effects added using backdrop-blur Tailwind utility.",
    "Stats grid has at least 3 cards highlighting Cost, Time, and Success Rate.",
    "Workspace compiles with no TypeScript warning logs."
  ],
  constraints: [
    "Must use standard Tailwind CSS classes.",
    "Do not exceed layout margins."
  ],
  knowledge: {
    ruleFile: "# Design Specs\n- Use theme glassmorphic colors\n- Ensure WCAG AAA contrast ratio.",
    commandsFile: "npm run build && npm run lint",
    architectureFile: "# Visual Portal Layer"
  },
  testSuite: {
    run: (files) => {
      const code = files["src/card.tsx"]?.content || "";
      const hasGlass = code.includes("backdrop-blur");
      const hasGrid = code.includes("grid");
      const hasCost = code.toLowerCase().includes("cost");

      if (!hasGlass || !hasGrid || !hasCost) {
        return {
          pass: false,
          summary: "Design Linter Warning: Incomplete Specs",
          details: `Design specification checker failed:
  ${!hasGlass ? "✕ backdrop-blur is missing for glassmorphic effect\n" : ""}${!hasGrid ? "✕ Grid container layout is missing for stats distribution\n" : ""}${!hasCost ? "✕ Cost statistic element is missing\n" : ""}`
        };
      }

      return {
        pass: true,
        summary: "Visual Card specifications match design guidelines perfectly. (10ms)",
        details: "[SUCCESS] Glassmorphism checked: Backdrop Blur enabled.\n[SUCCESS] Grid checked: Multi-column grid parsed.\n[SUCCESS] Content checked: Cost metric discovered."
      };
    }
  }
};

export const TemplatesList = [CalculatorTemplate, StringTemplate, Template3_Visual];
