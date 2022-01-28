import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import {
  AccountMeta,
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  Token,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  CHAIN_ID_ETH,
  CHAIN_ID_SOLANA,
  createNonce,
  hexToUint8Array,
  importTokenWasm,
  nativeToHexString,
  setDefaultWasm,
} from "@certusone/wormhole-sdk";

setDefaultWasm("node");

import logger from "loglevel";
import { serialize } from "borsh";

logger.enableAll(true);

function loadKeypair(pathname: string): Keypair {
  const keypairBuffer = fs.readFileSync(pathname, {});
  const keypairArray = JSON.parse(keypairBuffer.toString("utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(keypairArray));
}
enum Waypoint {
  TerraUST,
  BinanceWsUSDC,
}

class PrepareArgs {
  public static schema = [
    PrepareArgs,
    {
      kind: "struct",
      fields: [
        ["instruction", "u8"],
        ["amount", "u64"],
      ],
    },
  ];
  instruction = 0;
  amount: BigInt
  constructor(amount: number | BigInt) {
    if (typeof amount === 'number') {
      amount = BigInt(amount);
    }
    this.amount = amount;
  }
}

class SendArgs {
  public static schema = [
    SendArgs,
    {
      kind: "struct",
      fields: [
        ["instruction", "u8"],
        ["destination_address", [32]],
        ["transfer_nonce", "u32"],
        ["amount", "u64"],
      ],
    },
  ];

  instruction = 1;
  // amount: number
  destination_address: Uint8Array;
  transfer_nonce: number;
  amount: BigInt;

  // waypoint: Waypoint
  constructor(address: Uint8Array | string, amount: number) {
    // this.amount = amount;
    // this.address = address;
    // this.waypoint = destinationNetworkAsset;
    if (typeof address === "string") {
      address = hexToUint8Array(nativeToHexString(address, CHAIN_ID_ETH));
    }

    this.destination_address = address;
    this.transfer_nonce = createNonce().readInt32LE(0);
    this.amount = BigInt(amount);
  }
}

const SCHEMA: Map<Function, any> = new Map([
  PrepareArgs.schema,
  SendArgs.schema,
]);

let contractAddresses = {
  solanaCoreBridge: "3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5",
  solanaTokenBridge: "DZnkkTmCiFWfYTfT41X3Rd1kDgozqzxWaHqsw6W4x2oe",
  ethereumTokenBridge: "0xF890982f9310df57d00f659cf4fd87e65adEd8d7",
};

(async function begin() {
  const mintAddress = "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr";
  const deploymentKeypairPath = path.resolve(
    os.homedir(),
    ".config/solana/dev.json"
  );
  const deploymentKeypair = loadKeypair(deploymentKeypairPath);
  logger.info("deployment loaded:", deploymentKeypair.publicKey.toString());

  const programIdKeypairPath = path.resolve(
    __dirname,
    "../../../target/deploy/bpf_program_template-keypair.json"
  );
  const programId = loadKeypair(programIdKeypairPath);
  logger.info("program id loaded:", programId.publicKey.toString());

  logger.info("start...");

  const transaction = new Transaction();
  const input = new SendArgs(
    "0x3f9B413c05d526131A2A9b184E9b44Fbc0AeF3FC",
    10000
  );
  const data = Buffer.from(serialize(SCHEMA, input));
  const messageAccount = new Keypair();
  const fromAddress = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    new PublicKey(mintAddress),
    deploymentKeypair.publicKey
  );
  console.log(fromAddress.toString());
  const {
    approval_authority_address,
    transfer_wrapped_ix,
    transfer_native_ix,
  } = await importTokenWasm();
  const tokenBridgeApproveAuthority = approval_authority_address(
    contractAddresses.solanaTokenBridge
  );

  const prepareIx = new TransactionInstruction({
    programId: programId.publicKey,
    data: Buffer.from(serialize(SCHEMA, new PrepareArgs(input.amount))),
    keys: [
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: deploymentKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: fromAddress, isSigner: false, isWritable: true },
      // bridge fee address
      { pubkey: new PublicKey("7s3a1ycs16d6SNDumaRtjcoyMaTDZPavzgsmS3uUZYWX"), isSigner: false, isWritable: true, },
      // bridge state address
      { pubkey: new PublicKey("6bi4JGDoRwUs9TYBuvoA7dUVyikTJDrJsJU1ew6KVLiu"), isSigner: false, isWritable: false, },
      // approve authority of the token bridge, see token-bridge/transfer.ts:293
      { pubkey: new PublicKey(tokenBridgeApproveAuthority), isWritable: false, isSigner: false },
      { pubkey: new PublicKey(TOKEN_PROGRAM_ID), isSigner: false, isWritable: false, },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
  transaction.add(prepareIx);


  const fromAddressOwner = deploymentKeypair.publicKey;
  const wormholeTransferWrappedIx: {
    accounts: { pubkey: number[]; is_signer: boolean; is_writable: boolean }[];
  } = transfer_native_ix(
    contractAddresses.solanaTokenBridge,
    contractAddresses.solanaCoreBridge,
    deploymentKeypair.publicKey.toString(),
    messageAccount.publicKey.toString(),
    fromAddress.toString(),
    mintAddress,
    input.transfer_nonce,
    input.amount,
    BigInt(0),
    input.destination_address,
    CHAIN_ID_ETH
  );
  const transferWrappedIxAccounts =
    wormholeTransferWrappedIx.accounts.map<AccountMeta>((i) => ({
      pubkey: new PublicKey(i.pubkey),
      isSigner: i.is_signer,
      isWritable: i.is_writable,
    }));
  const m = transferWrappedIxAccounts.map((i) => i.pubkey.toString());

  const transferix = new TransactionInstruction({
    programId: programId.publicKey,
    keys: [
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },

      // payer account
      { pubkey: deploymentKeypair.publicKey, isSigner: true, isWritable: true },
      // message account for holding the VAA
      { pubkey: messageAccount.publicKey, isWritable: true, isSigner: true },
      // wallet token address to send the token and owner of the address
      { pubkey: fromAddress, isSigner: false, isWritable: true },
      // { pubkey: fromAddressOwner, isSigner: true, isWritable: true },
      // token mint address
      { pubkey: new PublicKey(mintAddress), isSigner: false, isWritable: true },

      // to transfer wrapped token
      // Config key
      transferWrappedIxAccounts[1],
      // custody key
      transferWrappedIxAccounts[4],
      // authority singer key
      transferWrappedIxAccounts[5],
      // custody signer key
      transferWrappedIxAccounts[6],
      // bridge config key
      transferWrappedIxAccounts[7],

      // emitter key
      transferWrappedIxAccounts[9],
      // sequence key
      transferWrappedIxAccounts[10],
      // fee collector key
      transferWrappedIxAccounts[11],

      // PROGRAM
      // Solana Wormhole token bridge program id
      {
        pubkey: new PublicKey(contractAddresses.solanaTokenBridge),
        isWritable: false,
        isSigner: false,
      },
      // Solana Wormhole core bridge program id
      {
        pubkey: new PublicKey(contractAddresses.solanaCoreBridge),
        isWritable: false,
        isSigner: false,
      },

      {
        pubkey: new PublicKey(TOKEN_PROGRAM_ID),
        isSigner: false,
        isWritable: false,
      },

      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  transaction.add(transferix);

  let connection = new Connection(clusterApiUrl("devnet"), {
    commitment: "singleGossip",
  });
  const result = await sendAndConfirmTransaction(connection, transaction, [
    deploymentKeypair,
    messageAccount,
  ]);
  logger.info(result);
})();
