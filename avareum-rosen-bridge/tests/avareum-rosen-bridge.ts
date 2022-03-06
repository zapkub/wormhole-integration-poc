import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import { AvareumRosenBridge } from '../target/types/avareum_rosen_bridge';

describe('avareum-rosen-bridge', () => {

  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.Provider.env());

  const program = anchor.workspace.AvareumRosenBridge as Program<AvareumRosenBridge>;

  it('Is initialized!', async () => {
    // Add your test here.
    const tx = await program.rpc.initialize({});
    console.log("Your transaction signature", tx);
  });
});
