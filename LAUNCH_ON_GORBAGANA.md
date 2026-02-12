# Launch Protocol: The Bin on Gorbagana Chain

This document serves as the official guide for deploying **The Bin** protocol to the **Gorbagana** blockchain.

## 1. Network Configuration

Before deployment, ensure your local Solana environment is targeted at the Gorbagana network.

### RPC Endpoint
Set your Solana CLI to use the Gorbagana RPC:
```bash
solana config set --url https://rpc.trashscan.io/
```

### Wallet Setup
Ensure you have a keypair ready. If not, generate one:
```bash
solana-keygen new --outfile ~/.config/solana/id.json
```

Verify your address and balance:
```bash
solana address
solana balance
```

### Faucet (Funding)
You will need **$GOR** (Gorbagana native token) to pay for deployment transaction fees.
- **Faucet URL:** [https://faucet.gorbagana.wtf/](https://faucet.gorbagana.wtf/)
- **Requirement:** Obtain ~5-10 $GOR.

---

## 2. Build Process

Compile the smart contracts using the Anchor framework.

1. Navigate to the programs directory:
   ```bash
   cd programs
   ```

2. Build the project:
   ```bash
   anchor build
   ```

3. **Critical Step:** Get the new Program ID:
   ```bash
   solana address -k target/deploy/the_bin-keypair.json
   ```

4. **Update Program ID:** You must replace the old Program ID with the new one generated above in the following files:
   - `programs/the-bin/src/lib.rs` (inside `declare_id!`)
   - `programs/Anchor.toml` (replace the address for `the_bin`)
   - `app/src/lib/program.ts` (update `PROGRAM_ID` constant)

5. Re-build to bake in the new ID:
   ```bash
   anchor build
   ```

---

## 3. Deployment

Deploy the compiled binary to the network.

```bash
anchor deploy --provider.cluster https://rpc.gorbagana.wtf/
```

**Verification:**
After deployment, confirm the program exists on-chain:
```bash
solana program show <YOUR_NEW_PROGRAM_ID>
```

---

## 4. Protocol Initialization

Once the program is deployed, the game state must be initialized.

Run the initialization script:
```bash
anchor run initialize
```
*Note: This usually runs `scripts/initialize.ts`.*

---

## 5. Frontend Integration

To connect the user interface to your new deployment:

1. Ensure `app/src/lib/program.ts` has the correct **Program ID**.
2. Update the RPC endpoint in your frontend config (likely `app/src/lib/config.ts` or `.env`) to point to `https://rpc.gorbagana.wtf/`.
3. Deploy your frontend (Vercel/Netlify) or run locally:
   ```bash
   cd app
   npm run dev
   ```

## 6. Resources & Tools

- **Block Explorer:** [TrashScan.io](https://trashscan.io)
- **RPC:** `https://rpc.gorbagana.wtf/`
- **Faucet:** `https://faucet.gorbagana.wtf/`
