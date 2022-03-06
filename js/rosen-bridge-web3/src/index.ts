import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { getDefaultProvider, Wallet } from "ethers";
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
import { NodeHttpTransport } from "@improbable-eng/grpc-web-node-http-transport";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  Token,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  attestFromEth,
  ChainId,
  CHAIN_ID_ETH,
  CHAIN_ID_SOLANA,
  createNonce,
  createWrappedOnSolana,
  getEmitterAddressEth,
  getEmitterAddressSolana,
  getIsTransferCompletedEth,
  getSignedVAA,
  hexToUint8Array,
  importTokenWasm,
  nativeToHexString,
  parseSequenceFromLogEth,
  parseSequenceFromLogSolana,
  postVaaSolana,
  redeemOnEth,
  redeemOnSolana,
  setDefaultWasm,
  transferFromEth,
  uint8ArrayToHex,
} from "@certusone/wormhole-sdk";
import { grpc } from "@improbable-eng/grpc-web";

setDefaultWasm("node");
grpc.setDefaultTransport(NodeHttpTransport());

import logger from "loglevel";
import { serialize } from "borsh";
import { zeroPad } from "@ethersproject/bytes";

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
  amount: BigInt;
  constructor(amount: number | BigInt) {
    if (typeof amount === "number") {
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

const WORMHOLE_RPC_HOSTS = "https://wormhole-v2-testnet-api.certus.one";

// ETH claim
let ethGoerli = getDefaultProvider("goerli", {
  etherscan: "AMNWGDFZH9J8TXSWD8J1BF1ADERTZUDH31",
});
const ethSigner = new Wallet(
  "fb39abdd1d9a0766a17a020213d762c9f829f83ef543a717661ccf0f26582bce",
  ethGoerli
);

const mintAddress = "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr";
const deploymentKeypairPath = path.resolve(
  os.homedir(),
  ".config/solana/dev.json"
);
const deploymentKeypair = loadKeypair(deploymentKeypairPath);
logger.info("deployment loaded:", deploymentKeypair.publicKey.toString());

let connection = new Connection(clusterApiUrl("devnet"), {
  commitment: "confirmed",
});

async function begin() {
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
  const tt = new PublicKey(tokenBridgeApproveAuthority);

  const prepareIx = new TransactionInstruction({
    programId: programId.publicKey,
    data: Buffer.from(serialize(SCHEMA, new PrepareArgs(input.amount))),
    keys: [
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: deploymentKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: fromAddress, isSigner: false, isWritable: true },
      // bridge fee address
      {
        pubkey: new PublicKey("7s3a1ycs16d6SNDumaRtjcoyMaTDZPavzgsmS3uUZYWX"),
        isSigner: false,
        isWritable: true,
      },
      // bridge state address
      {
        pubkey: new PublicKey("6bi4JGDoRwUs9TYBuvoA7dUVyikTJDrJsJU1ew6KVLiu"),
        isSigner: false,
        isWritable: false,
      },
      // approve authority of the token bridge, see token-bridge/transfer.ts:293
      {
        pubkey: new PublicKey(tokenBridgeApproveAuthority),
        isWritable: false,
        isSigner: false,
      },
      {
        pubkey: new PublicKey(TOKEN_PROGRAM_ID),
        isSigner: false,
        isWritable: false,
      },
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
  const emitterAddress = await getEmitterAddressSolana(
    contractAddresses.solanaTokenBridge
  );
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

  const resulttxid = await sendAndConfirmTransaction(connection, transaction, [
    deploymentKeypair,
    messageAccount,
  ]);
  logger.info(resulttxid);

  const transferTxIdInfo = await connection.getTransaction(resulttxid);
  const seqno = parseSequenceFromLogSolana(transferTxIdInfo);
  const signedVAA = await retryGetSignedVAA(
    WORMHOLE_RPC_HOSTS,
    CHAIN_ID_SOLANA,
    emitterAddress,
    seqno
  );

  const isComplete = await getIsTransferCompletedEth(
    contractAddresses.ethereumTokenBridge,
    ethGoerli,
    signedVAA
  );

  if (isComplete) {
    throw new Error("the tx is claimed");
  }

  const transferContractReceipt = await redeemOnEth(
    contractAddresses.ethereumTokenBridge,
    ethSigner,
    signedVAA
  );
  console.log("transferContractReceipt", transferContractReceipt);
}

const ethCoreBridge = "0x706abc4E45D419950511e474C7B9Ed348A4a716c";
const ethTokenBrige = "0xF890982f9310df57d00f659cf4fd87e65adEd8d7";
const ethWrappedTokenAddress = "0x0337f959cd91b61bdda8b469bdeccf702a6aa9fa";
async function transferBackFromEth(wallet: Wallet, recepient: Keypair) {
  try {
    /** skip attest */
    if (false) {
      const receipt = await attestFromEth(
        ethTokenBrige,
        wallet,
        ethWrappedTokenAddress
      );
      console.log(receipt);

      const sequence = parseSequenceFromLogEth(receipt, ethCoreBridge);
      const emitterAddress = getEmitterAddressEth(ethTokenBrige);
      // Fetch the signedVAA from the Wormhole Network (this may require retries while you wait for confirmation)
      const signedVAA = await retryGetSignedVAA(
        WORMHOLE_RPC_HOSTS,
        CHAIN_ID_ETH,
        emitterAddress,
        sequence
      );
      // On Solana, we have to post the signedVAA ourselves
      await postVaaSolana(
        connection,
        async (tx) => {
          tx.partialSign(deploymentKeypair);
          return tx;
        },
        contractAddresses.solanaCoreBridge,
        deploymentKeypair.publicKey.toString(),
        Buffer.from(signedVAA)
      );
      // Finally, create the wrapped token
      const transaction = await createWrappedOnSolana(
        connection,
        contractAddresses.solanaCoreBridge,
        contractAddresses.solanaTokenBridge,
        deploymentKeypair.publicKey.toString(),
        signedVAA
      );

      const txid = await connection.sendTransaction(transaction, [
        deploymentKeypair,
      ]);
      await connection.confirmTransaction(txid);
    }

    const toTokenAddress = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      new PublicKey(mintAddress),
      recepient.publicKey, 
    );

    const targetAddressForVAA = uint8ArrayToHex(
      zeroPad(toTokenAddress.toBytes(), 32)
    );
    const tx = await transferFromEth(
      ethCoreBridge,
      wallet,
      ethWrappedTokenAddress,
      1_000_000,
      CHAIN_ID_SOLANA,
      hexToUint8Array(targetAddressForVAA),
    );

    console.log(tx);
  } catch (e) {
    console.error(e);
  }
}


async function claimInSolana() {
  const hexVAA = '01000000000100c25de816a768b06ee6cd687530bf82a1cf284bdd77a4c8ff2562437424e9171b07d80d3dc282136e929e0fba4959c0c9dd104eaf8e673b536189605bedaabed501620d216c910901000002000000000000000000000000f890982f9310df57d00f659cf4fd87e65aded8d700000000000002780f010000000000000000000000000000000000000000000000000000000000002710e92839550965ffd4d64acaaf46d45df7318e5b4f57c90c487d60625d829b837b0001fab1a5d4cb4640c1f5b9c21394a0de5a77ec6f443e61143d5c12e8bcb1c7852a00010000000000000000000000000000000000000000000000000000000000000000'
  await postVaaSolana(
    connection,
    async (tx) => {
        tx.partialSign(deploymentKeypair)
        return tx;
    },
    contractAddresses.solanaCoreBridge,
    deploymentKeypair.publicKey.toString(),
    Buffer.from(hexToUint8Array(hexVAA)),
  )
  const tx = await redeemOnSolana(
    connection,
    contractAddresses.solanaCoreBridge,
    contractAddresses.solanaTokenBridge,
    deploymentKeypair.publicKey.toString(),
    hexToUint8Array(hexVAA)
  )
  const txid = await connection.sendTransaction(tx, [deploymentKeypair])
  console.log(txid)
}


// begin();

// transferBackFromEth(ethSigner, deploymentKeypair);

claimInSolana();




function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryGetSignedVAA(
  host: string,
  emitterChain: ChainId,
  emitterAddress: string,
  sequence: string
): Promise<Uint8Array> {
  let result: Awaited<ReturnType<typeof getSignedVAA>> | null = null;
  let retriedTime = 0;
  while (!result?.vaaBytes) {
    if (retriedTime > 150) {
      throw new Error("retryGetSignedVAA failed");
    }
    try {
      console.log("retry for signed VAA", retriedTime);
      result = await getSignedVAA(host, emitterChain, emitterAddress, sequence);
    } catch (e) {
      if (e.code !== 5) {
        throw e;
      }
      console.log("retryGetSignedVAA failed", e.code);
    }
    await sleep(1000);
    retriedTime++;
  }

  return result.vaaBytes;
}
