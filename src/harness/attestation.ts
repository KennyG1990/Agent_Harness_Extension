import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { HarnessState } from './types';
import { buildProofGraph, canonicalJson, proofGraphDigest, ProofGraphV1, verifyProofGraph } from './proofGraph';

export interface SecretStore {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

export interface RunAttestationV1 {
  schemaVersion: 1;
  statement: {
    sessionId: string;
    graphDigest: string;
    contractDigest: string;
    contractRevision: number;
    terminalStatus: HarnessState['status'];
    assurance: string;
    claimsSuccess: boolean;
    graphComplete: boolean;
    modelDriven: boolean;
    fallbackActions: number;
    greenOracle: boolean;
    evidenceCount: number;
    approvedReviewCount: number;
    extensionVersion: string;
    workspaceIdentityHash: string;
    keyId: string;
    issuedAt: string;
  };
  payloadDigest: string;
  algorithm: 'Ed25519';
  publicKeyPem: string;
  signatureBase64: string;
}

const KEY_SECRET = 'forge.attestation.ed25519.v1';

export class AttestationService {
  constructor(private readonly secrets: SecretStore, private readonly workspaceRoot: string, private readonly extensionVersion: string) {}

  public async attest(state: HarnessState, graph: ProofGraphV1): Promise<RunAttestationV1> {
    if (!['success', 'failed', 'gave_up'].includes(state.status)) throw new Error('Only terminal Forge runs may be attested.');
    const graphVerification = verifyProofGraph(graph);
    if (!graphVerification.valid) throw new Error(`Proof graph is invalid: ${graphVerification.errors.join(', ')}.`);
    if (graph.sessionId !== state.sessionId || graph.contractDigest !== state.executionContract.digest || graph.terminalStatus !== state.status) throw new Error('Proof graph does not match the terminal run state.');
    const derivedGraph = buildProofGraph(state);
    if (derivedGraph.digest !== graph.digest) throw new Error('Proof graph is stale or was not derived from the supplied terminal run state.');
    const key = await this.loadOrCreateKey();
    const statement: RunAttestationV1['statement'] = {
      sessionId: state.sessionId,
      graphDigest: graph.digest,
      contractDigest: state.executionContract.digest,
      contractRevision: state.executionContract.revision,
      terminalStatus: state.status,
      assurance: state.executionContract.authority.assurance,
      claimsSuccess: state.status === 'success' && graph.completeness.claimsSuccess,
      graphComplete: graph.completeness.complete,
      modelDriven: state.runStats?.actuallyModelDriven === true,
      fallbackActions: Number(state.runStats?.fallbackActions || 0),
      greenOracle: state.lastOraclePass === true,
      evidenceCount: (state.evidenceLedger || []).length,
      approvedReviewCount: [...(state.diffReviews || []), ...(state.reviewerCritiques || [])].filter(item => item.status === 'approved').length,
      extensionVersion: this.extensionVersion,
      workspaceIdentityHash: sha256(fs.realpathSync(this.workspaceRoot).toLowerCase()),
      keyId: key.keyId,
      issuedAt: new Date().toISOString()
    };
    const payload = Buffer.from(canonicalJson(statement), 'utf8');
    const attestation: RunAttestationV1 = {
      schemaVersion: 1,
      statement,
      payloadDigest: sha256(payload),
      algorithm: 'Ed25519',
      publicKeyPem: key.publicKeyPem,
      signatureBase64: crypto.sign(null, payload, key.privateKeyPem).toString('base64')
    };
    const verification = verifyAttestation(attestation, graph);
    if (!verification.valid) throw new Error(`Generated attestation failed self-verification: ${verification.errors.join(', ')}.`);
    this.persist(attestation);
    return attestation;
  }

  public async rotateKey(): Promise<{ keyId: string; publicKeyPem: string }> {
    await this.secrets.delete(KEY_SECRET);
    const key = await this.loadOrCreateKey();
    return { keyId: key.keyId, publicKeyPem: key.publicKeyPem };
  }

  private async loadOrCreateKey(): Promise<{ privateKeyPem: string; publicKeyPem: string; keyId: string }> {
    const existing = await this.secrets.get(KEY_SECRET);
    if (existing) {
      const parsed = JSON.parse(existing);
      const publicKeyPem = String(parsed.publicKeyPem || '');
      const privateKeyPem = String(parsed.privateKeyPem || '');
      const keyId = sha256(publicKeyPem).slice(0, 32);
      if (!publicKeyPem || !privateKeyPem || parsed.keyId !== keyId) throw new Error('Stored attestation key material is invalid.');
      return { publicKeyPem, privateKeyPem, keyId };
    }
    const pair = crypto.generateKeyPairSync('ed25519');
    const privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const keyId = sha256(publicKeyPem).slice(0, 32);
    await this.secrets.store(KEY_SECRET, JSON.stringify({ privateKeyPem, publicKeyPem, keyId, createdAt: new Date().toISOString() }));
    return { privateKeyPem, publicKeyPem, keyId };
  }

  private persist(attestation: RunAttestationV1): void {
    const directory = path.join(this.workspaceRoot, '.forge', 'attestations');
    fs.mkdirSync(directory, { recursive: true });
    writeAtomic(path.join(directory, `${safeId(attestation.statement.sessionId)}.json`), attestation);
    writeAtomic(path.join(this.workspaceRoot, '.forge', 'latest-attestation.json'), attestation);
    writeAtomic(path.join(this.workspaceRoot, '.forge', 'attestation-public-key.json'), { schemaVersion: 1, keyId: attestation.statement.keyId, algorithm: attestation.algorithm, publicKeyPem: attestation.publicKeyPem });
  }
}

export function verifyAttestation(attestation: RunAttestationV1, graph: ProofGraphV1): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const graphResult = verifyProofGraph(graph);
  if (!graphResult.valid) errors.push(...graphResult.errors);
  if (proofGraphDigest(graph) !== attestation.statement.graphDigest) errors.push('attested graph digest mismatch');
  if (attestation.statement.contractDigest !== graph.contractDigest) errors.push('attested contract digest mismatch');
  if (attestation.statement.terminalStatus !== graph.terminalStatus) errors.push('attested terminal status mismatch');
  if (attestation.statement.graphComplete !== graph.completeness.complete) errors.push('attested graph completeness mismatch');
  const payload = Buffer.from(canonicalJson(attestation.statement), 'utf8');
  if (sha256(payload) !== attestation.payloadDigest) errors.push('attestation payload digest mismatch');
  if (sha256(attestation.publicKeyPem).slice(0, 32) !== attestation.statement.keyId) errors.push('attestation key id mismatch');
  try { if (!crypto.verify(null, payload, attestation.publicKeyPem, Buffer.from(attestation.signatureBase64, 'base64'))) errors.push('signature verification failed'); }
  catch { errors.push('public key or signature is invalid'); }
  if (attestation.statement.claimsSuccess && (!attestation.statement.graphComplete || attestation.statement.terminalStatus !== 'success' || !graph.completeness.claimsSuccess)) errors.push('invalid success claim');
  return { valid: errors.length === 0, errors };
}

function sha256(value: string | Buffer): string { return crypto.createHash('sha256').update(value).digest('hex'); }
function safeId(value: string): string { const result = String(value || '').replace(/[^a-zA-Z0-9._:-]/g, '_').slice(0, 120); if (!result) throw new Error('Invalid attestation session id.'); return result; }
function writeAtomic(target: string, value: unknown): void { const temp = `${target}.${process.pid}.${Date.now()}.tmp`; fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8'); fs.renameSync(temp, target); }
