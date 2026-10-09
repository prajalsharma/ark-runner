/**
 * archTx — PROVES the client builds the on-chain JoinMatch transaction byte-for-byte the way the
 * canonical Rust SDK (arch_sdk 0.12) does. The golden `serialize` / `hash` values below were
 * produced by the real SDK via:
 *
 *   cargo build --release --manifest-path server/arch-settle/Cargo.toml
 *   ./server/arch-settle/target/release/arch-settle join-bytes \
 *       1111…11 (player x-only)  1791521107411 (match_id)  2222…22 (blockhash)
 *
 * If the TS message serialization or the double-SHA256 signing digest ever drift from the SDK,
 * these assertions fail. That is the whole point: the wallet-signed join can only be correct if
 * the bytes the wallet signs are the exact bytes the node will verify.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildJoinInstructions, compileMessage, serializeMessage, messageDigestHex,
} from "../src/chain/archTx.ts";
import { hexToBytes, bytesToHex } from "../src/chain/archRead.ts";
import { extractSchnorrSignature, toXOnlyHex } from "../src/wallet/arch.ts";

const PLAYER = "1111111111111111111111111111111111111111111111111111111111111111";
const MATCH_ID = 1791521107411n;
const BLOCKHASH = "2222222222222222222222222222222222222222222222222222222222222222";

// Golden output of arch_sdk 0.12 `ArchMessage::{serialize,hash}` for the join above.
const GOLDEN_SERIALIZE =
  "0100060a00000011111111111111111111111111111111111111111111111111111111111111113cfd3936545581fc21d938311491f8794c0064c1b239a9b7770bf82376518d494c178ea1a338f5b7cb50b80062be39e442cdd35ef1af2356cc93cf64c1371a39ba980d2fc2f910a19af726ffd4fa685bbff3fced736b7e73e8fe0aef6980aec4000000000000000000000000000000000000000000000000000000000000000006ddf6e1b9ea84412c10b8df021c100fc8871907c309c33535de209c341763bf2a6c8835a36d6d4976e84553c9b3a0efb299658b608b34745764ae665f49d9296e31324a4fc9d70d2ea0ed5417b9ed9208e8ea314ac46065eacb0af3441e0e428c97231184927b77b5f180118fcc683414b77c521e5a77081cf71d5f606a5384dc9ea90156bde1d13654945ce6403e04163d135c3cea87f9efc2ab89f49fe5722222222222222222222222222222222222222222222222222222222222222222020000000806000000000200060405010000000107060000000009030201050100000002";
const GOLDEN_HASH = "5b801657ad38c5462006b8a23f9d07640b4a459549c80f769c28b9a71b0509ca";

test("client builds the JoinMatch message byte-exact vs arch_sdk 0.12", async () => {
  const ixs = await buildJoinInstructions(PLAYER, MATCH_ID);
  const compiled = compileMessage(ixs, hexToBytes(PLAYER));
  // single signer = the player (payer); 6 readonly unsigned program/config/mint/system accounts
  assert.equal(compiled.header.numRequiredSignatures, 1);
  assert.equal(compiled.header.numReadonlySigned, 0);
  assert.equal(compiled.header.numReadonlyUnsigned, 6);
  assert.equal(compiled.accountKeys.length, 10);

  const serialized = serializeMessage(compiled, hexToBytes(BLOCKHASH));
  assert.equal(bytesToHex(serialized), GOLDEN_SERIALIZE, "ArchMessage::serialize must match the SDK");

  const digest = await messageDigestHex(serialized);
  assert.equal(digest, GOLDEN_HASH, "ArchMessage::hash (the BIP-322 signing digest) must match the SDK");
});

test("x-only pubkey normalisation", () => {
  const x = "ab".repeat(32);
  assert.equal(toXOnlyHex(x), x);
  assert.equal(toXOnlyHex("02" + x), x, "compressed pubkey → drop the parity prefix");
  assert.equal(toXOnlyHex("0x" + x), x);
  assert.throws(() => toXOnlyHex("deadbeef"));
});

test("Schnorr signature extraction from a BIP-322 witness", () => {
  // 64-byte sig wrapped as a single-item witness: [count=1][len=0x40][64 bytes]
  const sig = new Uint8Array(64).map((_, i) => i & 0xff);
  const witness64 = new Uint8Array([1, 0x40, ...sig]);
  const b64 = Buffer.from(witness64).toString("base64");
  assert.deepEqual(extractSchnorrSignature(b64), sig);

  // SIGHASH_ALL variant: [count=1][len=0x41][64 sig + 1 flag]
  const witness65 = new Uint8Array([1, 0x41, ...sig, 0x01]);
  assert.deepEqual(extractSchnorrSignature(Buffer.from(witness65).toString("base64")), sig);

  // bare 64-byte signature (some wallets)
  assert.deepEqual(extractSchnorrSignature(Buffer.from(sig).toString("base64")), sig);
});
