//! arch-settle — ARCH RUNNER settlement signer (server-side ONLY).
//!
//! The only component that loads the settlement-authority secret and signs on-chain
//! transactions. Invoked by the Node settlement service as a child process; it prints a
//! single JSON line on stdout. The key is read from `ARCH_SETTLEMENT_AUTHORITY_SECRET`,
//! which is either a 64-hex secret or a path to a file containing it (a path is preferred
//! so the secret never appears in the process table). Built on arch_sdk 0.12 — the same
//! v0.12-correct client that E2E-verified the economy (docs/DEPLOYMENT_RESULT.md).
//!
//! Subcommands:
//!   create-match <match_id> <max_players>            -> {"txid"}
//!   settle       <match_id> <rankings_csv> [hash32]  -> {"txid","pot","payouts"}
//!   seed-players <match_id> <count>                  -> {"players":[hex...]}   (TEST: self-joins)
//!
//! `seed-players` exists only to drive E2E verification: in production, players join with
//! their own wallet signature — the authority never signs a join. create-match and settle
//! are the real authority operations.

use std::{env, process, thread, time::Duration};

use apl_associated_token_account as ata_prog;
use ark_runner_escrow::EscrowInstruction;
use arch_sdk::{
    arch_program::{
        account::AccountMeta, instruction::Instruction, pubkey::Pubkey,
        sanitized::ArchMessage, system_program::SYSTEM_PROGRAM_ID,
    },
    blocking::ArchRpcClient,
    build_and_sign_transaction, Config, Status,
};
use bitcoin::{
    key::Keypair,
    secp256k1::{Secp256k1, SecretKey},
    Network,
};
use sha2::{Digest, Sha256};

const RPC: &str = "https://rpc.testnet.arch.network/";
const PROGRAM_HEX: &str = "6e31324a4fc9d70d2ea0ed5417b9ed9208e8ea314ac46065eacb0af3441e0e42";
const MINT_HEX: &str = "2a6c8835a36d6d4976e84553c9b3a0efb299658b608b34745764ae665f49d929";

fn die(msg: &str) -> ! {
    // Errors go to stderr so stdout stays a clean single JSON line for the caller.
    eprintln!("arch-settle error: {msg}");
    process::exit(1);
}

fn pk_from_hex(h: &str) -> Pubkey {
    Pubkey::from_slice(&hex::decode(h).unwrap_or_else(|_| die("bad hex pubkey")))
}

/// Load the authority keypair from ARCH_SETTLEMENT_AUTHORITY_SECRET (64-hex or a file path).
fn load_authority() -> Keypair {
    let v = env::var("ARCH_SETTLEMENT_AUTHORITY_SECRET")
        .unwrap_or_else(|_| die("ARCH_SETTLEMENT_AUTHORITY_SECRET is not set"));
    let raw = if is_hex64(v.trim()) {
        v.trim().to_string()
    } else {
        std::fs::read_to_string(&v)
            .unwrap_or_else(|_| die("ARCH_SETTLEMENT_AUTHORITY_SECRET is neither 64-hex nor a readable file path"))
            .trim()
            .to_string()
    };
    if !is_hex64(&raw) {
        die("authority secret must be 64 hex characters");
    }
    let bytes = hex::decode(&raw).unwrap_or_else(|_| die("authority secret hex decode failed"));
    let sk = SecretKey::from_slice(&bytes[..32]).unwrap_or_else(|_| die("invalid secp256k1 secret"));
    Keypair::from_secret_key(&Secp256k1::new(), &sk)
}

fn is_hex64(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn pubkey_of(kp: &Keypair) -> Pubkey {
    Pubkey::from_slice(&kp.x_only_public_key().0.serialize())
}

fn rpc_config() -> Config {
    Config {
        node_endpoint: String::new(),
        node_username: String::new(),
        node_password: String::new(),
        network: Network::Testnet4,
        arch_node_url: RPC.to_string(),
        titan_url: String::new(),
    }
}

fn config_pda(program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"config"], program).0
}
fn match_pda(program: &Pubkey, id: u64) -> Pubkey {
    Pubkey::find_program_address(&[b"match", &id.to_le_bytes()], program).0
}
fn ata_of(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    ata_prog::get_associated_token_address_and_bump_seed(owner, mint, &ata_prog::id()).0
}

fn send(client: &ArchRpcClient, ixs: &[Instruction], payer: Pubkey, signers: Vec<Keypair>, label: &str) -> String {
    let blockhash = client
        .get_best_finalized_block_hash()
        .unwrap_or_else(|e| die(&format!("{label}: blockhash: {e}")));
    let msg = ArchMessage::new(ixs, Some(payer), blockhash);
    let tx = build_and_sign_transaction(msg, signers, Network::Testnet4)
        .unwrap_or_else(|e| die(&format!("{label}: sign: {e}")));
    let txid = client
        .send_transaction(tx)
        .unwrap_or_else(|e| die(&format!("{label}: send: {e}")));
    let processed = client
        .wait_for_processed_transaction(&txid)
        .unwrap_or_else(|e| die(&format!("{label}: wait: {e}")));
    match &processed.status {
        Status::Processed => txid.to_string(),
        other => die(&format!("{label}: tx {txid} status {other:?}; logs {:?}", processed.logs)),
    }
}

fn fund_gas(client: &ArchRpcClient, kp: &Keypair, pk: &Pubkey, min_lamports: u64) {
    for _ in 0..8 {
        let bal = client.read_account_info(*pk).map(|a| a.lamports).unwrap_or(0);
        if bal >= min_lamports {
            return;
        }
        let _ = client.create_and_fund_account_with_faucet(kp);
        thread::sleep(Duration::from_millis(800));
    }
}

fn read_match_raw(client: &ArchRpcClient, m_pda: &Pubkey) -> Vec<u8> {
    client
        .read_account_info(*m_pda)
        .unwrap_or_else(|e| die(&format!("read match: {e}")))
        .data
}

/// (joined, players, state) decoded from the Match account (layout in program/src/lib.rs).
fn match_fields(data: &[u8]) -> (u8, Vec<Pubkey>, u8) {
    if data.len() < 333 {
        die("match account not initialised (create it first)");
    }
    let joined = data[17];
    let state = data[18];
    let mut players = Vec::new();
    for i in 0..8usize {
        players.push(Pubkey::from_slice(&data[44 + i * 32..44 + i * 32 + 32]));
    }
    (joined, players, state)
}

fn create_ata_idem_ix(funder: &Pubkey, wallet: &Pubkey, mint: &Pubkey) -> Instruction {
    let ata = ata_of(wallet, mint);
    ata_prog::create_associated_token_account_idempotent(funder, &ata, wallet, mint, &apl_token::id(), &SYSTEM_PROGRAM_ID)
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        die("usage: arch-settle <create-match|settle|seed-players> ...");
    }
    let client = ArchRpcClient::new(&rpc_config());
    let program = pk_from_hex(PROGRAM_HEX);
    let mint = pk_from_hex(MINT_HEX);
    let authority = load_authority();
    let auth_pk = pubkey_of(&authority);
    let cfg_pda = config_pda(&program);

    match args[1].as_str() {
        "create-match" => {
            let match_id: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or_else(|| die("match_id u64 required"));
            let max_players: u8 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or_else(|| die("max_players u8 required"));
            fund_gas(&client, &authority, &auth_pk, 2_000_000);
            let m_pda = match_pda(&program, match_id);
            let vault = ata_of(&m_pda, &mint);
            let data = borsh::to_vec(&EscrowInstruction::CreateMatch { match_id, max_players }).unwrap();
            let ix = Instruction {
                program_id: program,
                accounts: vec![
                    AccountMeta::new(auth_pk, true),
                    AccountMeta::new_readonly(cfg_pda, false),
                    AccountMeta::new(m_pda, false),
                    AccountMeta::new(vault, false),
                    AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
                ],
                data,
            };
            let txid = send(&client, &[create_ata_idem_ix(&auth_pk, &m_pda, &mint), ix], auth_pk, vec![authority], "create_match");
            println!(
                "{{\"txid\":\"{}\",\"matchId\":{},\"matchPda\":\"{}\",\"vault\":\"{}\"}}",
                txid, match_id, hex::encode(m_pda.as_ref()), hex::encode(vault.as_ref())
            );
        }

        "seed-players" => {
            // TEST ONLY: create `count` funded players and self-join them so a real settle
            // can be driven end-to-end. Production joins are player-wallet-signed.
            let match_id: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or_else(|| die("match_id required"));
            let count: usize = args.get(3).and_then(|s| s.parse().ok()).unwrap_or_else(|| die("count required"));
            let entry = read_entry(&client, &cfg_pda);
            fund_gas(&client, &authority, &auth_pk, 2_000_000);
            let m_pda = match_pda(&program, match_id);
            let vault = ata_of(&m_pda, &mint);
            let mut out: Vec<String> = Vec::new();
            for _ in 0..count {
                let kp = loop {
                    let mut seed = [0u8; 32];
                    rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut seed);
                    if let Ok(sk) = SecretKey::from_slice(&seed) {
                        break Keypair::from_secret_key(&Secp256k1::new(), &sk);
                    }
                };
                let pk = pubkey_of(&kp);
                fund_gas(&client, &kp, &pk, 1_000_000);
                let ata = ata_of(&pk, &mint);
                // authority is the mint authority: mint entry stake to the player
                let mint_to = apl_token::instruction::mint_to(&apl_token::id(), &mint, &ata, &auth_pk, &[], entry).unwrap();
                send(&client, &[create_ata_idem_ix(&auth_pk, &pk, &mint), mint_to], auth_pk, vec![authority], "mint->player");
                // player self-joins
                let join = Instruction {
                    program_id: program,
                    accounts: vec![
                        AccountMeta::new(pk, true),
                        AccountMeta::new_readonly(cfg_pda, false),
                        AccountMeta::new(m_pda, false),
                        AccountMeta::new(ata, false),
                        AccountMeta::new(vault, false),
                        AccountMeta::new_readonly(apl_token::id(), false),
                    ],
                    data: borsh::to_vec(&EscrowInstruction::JoinMatch).unwrap(),
                };
                send(&client, &[join], pk, vec![kp], "join");
                out.push(hex::encode(pk.as_ref()));
            }
            let joined = out.iter().map(|p| format!("\"{p}\"")).collect::<Vec<_>>().join(",");
            println!("{{\"players\":[{}]}}", joined);
        }

        "settle" => {
            let match_id: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or_else(|| die("match_id required"));
            let rankings_csv = args.get(3).unwrap_or_else(|| die("rankings csv required (player indices, best first)"));
            fund_gas(&client, &authority, &auth_pk, 1_000_000);
            let m_pda = match_pda(&program, match_id);
            let vault = ata_of(&m_pda, &mint);
            let raw = read_match_raw(&client, &m_pda);
            let (joined, players, _state) = match_fields(&raw);
            if joined == 0 {
                die("no players joined; nothing to settle");
            }
            // rankings: parse, validate permutation of 0..joined, pad to 8
            let parsed: Vec<u8> = rankings_csv.split(',').map(|s| s.trim().parse().unwrap_or_else(|_| die("bad ranking index"))).collect();
            if parsed.len() != joined as usize {
                die(&format!("rankings length {} != joined {}", parsed.len(), joined));
            }
            let mut seen = [false; 8];
            for &r in &parsed {
                if r as usize >= joined as usize || seen[r as usize] {
                    die("rankings must be a permutation of 0..joined");
                }
                seen[r as usize] = true;
            }
            let mut rankings = [0u8; 8];
            rankings[..parsed.len()].copy_from_slice(&parsed);

            // result_hash: explicit hex arg, else sha256(match_id_le || rankings[0..joined])
            let result_hash: [u8; 32] = match args.get(4) {
                Some(h) => {
                    let b = hex::decode(h).unwrap_or_else(|_| die("result hash must be hex"));
                    if b.len() != 32 {
                        die("result hash must be 32 bytes");
                    }
                    let mut a = [0u8; 32];
                    a.copy_from_slice(&b);
                    a
                }
                None => {
                    let mut h = Sha256::new();
                    h.update(match_id.to_le_bytes());
                    h.update(&parsed);
                    h.finalize().into()
                }
            };

            let k = if joined >= 4 { 3usize } else { 1usize };
            let mut accounts = vec![
                AccountMeta::new(auth_pk, true),
                AccountMeta::new_readonly(cfg_pda, false),
                AccountMeta::new(m_pda, false),
                AccountMeta::new(vault, false),
                AccountMeta::new_readonly(apl_token::id(), false),
            ];
            let mut winners = Vec::new();
            for rank in rankings.iter().take(k) {
                let w = players[*rank as usize];
                winners.push(hex::encode(w.as_ref()));
                accounts.push(AccountMeta::new(ata_of(&w, &mint), false));
            }
            let ix = Instruction {
                program_id: program,
                accounts,
                data: borsh::to_vec(&EscrowInstruction::SettleMatch { result_hash, rankings }).unwrap(),
            };
            let entry = read_entry(&client, &cfg_pda);
            let pot = entry * joined as u64;
            let txid = send(&client, &[ix], auth_pk, vec![authority], "settle_match");
            let winners_json = winners.iter().map(|w| format!("\"{w}\"")).collect::<Vec<_>>().join(",");
            println!(
                "{{\"txid\":\"{}\",\"matchId\":{},\"joined\":{},\"pot\":{},\"winners\":[{}],\"resultHash\":\"{}\"}}",
                txid, match_id, joined, pot, winners_json, hex::encode(result_hash)
            );
        }

        other => die(&format!("unknown subcommand: {other}")),
    }
}

fn read_entry(client: &ArchRpcClient, cfg_pda: &Pubkey) -> u64 {
    let data = client
        .read_account_info(*cfg_pda)
        .unwrap_or_else(|e| die(&format!("read config: {e}")))
        .data;
    if data.len() < 104 {
        die("config not initialised");
    }
    let mut b = [0u8; 8];
    b.copy_from_slice(&data[96..104]); // entry: u64 at offset 96
    u64::from_le_bytes(b)
}
