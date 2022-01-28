use std::borrow::Borrow;
use std::rc::Rc;

use arrayref::array_ref;
use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::account_info::next_account_info;
use solana_program::instruction::Instruction;
use solana_program::program::{invoke, invoke_signed};
use solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, msg, pubkey::Pubkey,
    system_instruction,
};

use crate::instruction::{RosenBridgeInstruction, SendArgs, Waypoint};
use spl_token::instruction::approve;
use token_bridge::instructions::{transfer_native, transfer_wrapped};
use token_bridge::{TransferNativeData, TransferWrappedData};

#[derive(BorshSerialize, BorshDeserialize, Clone)]
pub struct BridgeConfig {
    /// Period for how long a guardian set is valid after it has been replaced by a new one.  This
    /// guarantees that VAAs issued by that set can still be submitted for a certain period.  In
    /// this period we still trust the old guardian set.
    pub guardian_set_expiration_time: u32,

    /// Amount of lamports that needs to be paid to the protocol to post a message
    pub fee: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Clone)]
pub struct BridgeData {
    /// The current guardian set index, used to decide which signature sets to accept.
    pub guardian_set_index: u32,

    /// Lamports in the collection account
    pub last_lamports: u64,

    /// Bridge configuration, which is set once upon initialization.
    pub config: BridgeConfig,
}

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let instruction = RosenBridgeInstruction::try_from_slice(instruction_data)?;
    match instruction {
        RosenBridgeInstruction::Prepare(args) => {
            let program_id = next_account_info(account_info_iter)?;
            let payer_account = next_account_info(account_info_iter)?;
            let from = next_account_info(account_info_iter)?; // SPL associate token account
            let bridge_fee_account = next_account_info(account_info_iter)?;
            let bridge_state_id = next_account_info(account_info_iter)?; // see wormhole/sdk/js/src/solana/getBridgeFeeIx.ts
            let bridge_token_authority = next_account_info(account_info_iter)?;
            let token_program_id = next_account_info(account_info_iter)?;
            let system_program_id = next_account_info(account_info_iter)?;
            let d = bridge_state_id.data.take();
            let mut bridge_data = BridgeData::try_from_slice(d)?;
            let transfer_fee_ix = system_instruction::transfer(
                payer_account.key,
                bridge_fee_account.key,
                bridge_data.config.fee,
            );
            invoke(
                &transfer_fee_ix,
                &[
                    payer_account.clone(),
                    bridge_fee_account.clone(),
                    system_program_id.clone(),
                ],
            )?;
            let approve_ix = approve(
                token_program_id.key,
                from.key,
                bridge_token_authority.key,
                payer_account.key,
                &[],
                args.amount,
            )?;
            invoke(
                &approve_ix,
                &[
                    from.clone(),
                    bridge_token_authority.clone(),
                    payer_account.clone(),
                ],
            );

            Ok(())
        },
        RosenBridgeInstruction::Send(args) => {
            // worked tx
            // https://explorer.solana.com/tx/5diENkes822S1VYWT3eGLNsmCrNfRia6bswxtYE3ay8CrBUtco65b47VBUy8YJmo9ovJhvWJYmKGijCQ1N1vNoti?cluster=devnet

            let program_id = next_account_info(account_info_iter)?;
            let payer_account = next_account_info(account_info_iter)?;
            let message_key = next_account_info(account_info_iter)?; // new generated account keypair (need signer)

            let from = next_account_info(account_info_iter)?; // SPL associate token account
            let mint_address = next_account_info(account_info_iter)?; // token mint address

            let config_key = next_account_info(account_info_iter)?;
            let custody_key = next_account_info(account_info_iter)?;
            let authority_signer_key = next_account_info(account_info_iter)?;
            let custody_signer_key = next_account_info(account_info_iter)?;
            let bridge_config_key = next_account_info(account_info_iter)?;
            let emitter_key = next_account_info(account_info_iter)?;
            let sequence_key = next_account_info(account_info_iter)?;
            let fee_collector_key = next_account_info(account_info_iter)?;
            let token_bridge_program_id = next_account_info(account_info_iter)?; // this is token bridge program id
            let bridge_program_id = next_account_info(account_info_iter)?;
            let token_program_id = next_account_info(account_info_iter)?;
            let clock_program_id = next_account_info(account_info_iter)?;
            let rent_program_id = next_account_info(account_info_iter)?;
            let system_program_id = next_account_info(account_info_iter)?;

            let token_chain: u16 = 1; // this is SOLANA CHAIN ID
            let data = TransferNativeData {
                nonce: args.transfer_nonce,
                amount: args.amount,
                fee: 0, // fee is 0 for some reason.... see token_bridge/transfer.ts:279
                target_chain: 2, // this is ETH chain ID
                target_address: args.destination_address,
            };

            let transfer_native_ix = transfer_native(
                token_bridge_program_id.key.clone(),
                bridge_program_id.key.clone(),
                payer_account.key.clone(),
                message_key.key.clone(),
                from.key.clone(),
                mint_address.key.clone(),
                data,
            );
            if transfer_native_ix.is_err() {
                msg!("transfer_wrapped_ix is err");
            }

            let transfer_native_ix = &transfer_native_ix.unwrap();
            invoke(
                &transfer_native_ix,
                &[
                    payer_account.clone(),
                    config_key.clone(),
                    from.clone(),
                    mint_address.clone(),
                    custody_key.clone(),
                    authority_signer_key.clone(),
                    custody_signer_key.clone(),
                    bridge_config_key.clone(),
                    message_key.clone(),
                    emitter_key.clone(),
                    sequence_key.clone(),
                    fee_collector_key.clone(),
                    clock_program_id.clone(),
                    rent_program_id.clone(),
                    system_program_id.clone(),
                    bridge_program_id.clone(),
                    token_program_id.clone(),
                ],
            )?;

            return Ok(());
        }
    }
}

fn process_send(args: SendArgs) -> ProgramResult {
    return Ok(());
}

#[cfg(test)]
mod test {
    use {
        super::*,
        assert_matches::*,
        solana_program::instruction::{AccountMeta, Instruction},
        solana_program_test::*,
        solana_sdk::{signature::Signer, transaction::Transaction},
    };

    #[tokio::test]
    async fn test_transaction() {
        let program_id = Pubkey::new_unique();

        let (mut banks_client, payer, recent_blockhash) = ProgramTest::new(
            "bpf_program_template",
            program_id,
            processor!(process_instruction),
        )
        .start()
        .await;

        let mut transaction = Transaction::new_with_payer(
            &[Instruction {
                program_id,
                accounts: vec![AccountMeta::new(payer.pubkey(), false)],
                data: vec![1, 2, 3],
            }],
            Some(&payer.pubkey()),
        );
        transaction.sign(&[&payer], recent_blockhash); // comment here
                                                       // and then new line
                                                       // it will be indent to the end of the line

        assert_matches!(banks_client.process_transaction(transaction).await, Ok(()));
    }
}
