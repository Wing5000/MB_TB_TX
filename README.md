# Moonbeam Contract Monitor

A simple frontend tool that tracks which addresses interacted with a predefined Moonbeam smart contract.

## Configuration

- **START_BLOCK** – block number from which the application starts fetching history. Set it via environment variable or by assigning `window.START_BLOCK` before loading the script.
- If `START_BLOCK` is not set, the app falls back to `DEFAULT_DEPLOY_BLOCK` from the code.

## Usage

1. (Optional) Copy `.env.example` to `.env` and adjust `START_BLOCK`.
2. Open `index.html` in your browser.
3. The table will display unique addresses and transaction counts.

No Moonscan API key is required; data is fetched directly from Moonbeam RPC endpoints.
