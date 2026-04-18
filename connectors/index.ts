import { setWeb3LibraryCallback } from "@instadapp/vue-web3";
import { InjectedConnector } from "@web3-react/injected-connector";
import { WalletConnectConnector } from "@web3-react/walletconnect-connector";
import { PortisConnector } from "@web3-react/portis-connector";
import { WalletLinkConnector } from "@web3-react/walletlink-connector";
// import { LedgerConnector } from "@web3-react/ledger-connector";
import { LedgerConnector } from "./ledger-connector";

import INSTADAPP_LOGO_URL from "~/assets/logo/instadapp-logo-icon.svg?inline";

import Web3 from "web3";
import { SafeAppConnector } from "@gnosis.pm/safe-apps-web3-react/dist/connector";

setWeb3LibraryCallback(provider => new Web3(provider));

export const injected = new InjectedConnector({
  supportedChainIds: [137, 8453, 1, 42161, 43114, 10]
});

export const walletconnect = new WalletConnectConnector({
  rpc: {
    137: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
    8453: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    1: `https://mainnet.infura.io/v3/${process.env.INFURA_ID}`,
    42161: "https://arb1.arbitrum.io/rpc",
    43114: "https://api.avax.network/ext/bc/C/rpc",
    10: "https://optimistic.etherscan.io",
  },
  supportedChainIds: [137, 8453, 1, 42161, 43114, 10]
});

// mainnet only
export const portis = new PortisConnector({
  dAppId: process.env.PORTIS_ID as string,
  networks: [1]
});

export const walletlink = new WalletLinkConnector({
  url: `https://mainnet.infura.io/v3/${process.env.INFURA_ID}`,
  appName: "Instadapp",
  appLogoUrl: INSTADAPP_LOGO_URL
});

let gnosisSafe = null;

if (process.client) {
  gnosisSafe = new SafeAppConnector({
    supportedChainIds: [137, 8453, 1, 42161, 43114, 10]
  });
}

export { gnosisSafe };

const POLLING_INTERVAL = 12000;

export enum LedgerDerivationPath {
  "Legacy" = "44'/60'/0'/x",
  "LedgerLive" = "44'/60'/x'/0/0"
}

export const ledger = new LedgerConnector({
  chainId: 1,
  url: `https://mainnet.infura.io/v3/${process.env.INFURA_ID}`,
  pollingInterval: POLLING_INTERVAL,
  baseDerivationPath: LedgerDerivationPath.LedgerLive,
  accountsOffset: 0,
  accountsLength: 4
});
