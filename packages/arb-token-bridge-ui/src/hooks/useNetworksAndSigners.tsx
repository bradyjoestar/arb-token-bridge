/*

Hooks and utility functions written to maintain L1 and L2 connnection state (using context) and their metadata across the Bridge UI.
These can be used to answer and access the following use-cases across the app -

1. Is the network connected? If yes, is it Arbitrum (L2) or Ethereum (L1)?
2. Signer exposed by the wallet to sign and execute RPC transactions
3. Provider exposed by the wallet to query the blockchain

*/

import React, {
  useCallback,
  useEffect,
  useState,
  useContext,
  createContext
} from 'react'
import {
  JsonRpcSigner,
  JsonRpcProvider,
  Web3Provider
} from '@ethersproject/providers'
import { L1Network, L2Network, getL1Network, getL2Network,addCustomNetwork } from '@arbitrum/sdk'
import { useWallet } from '@arbitrum/use-wallet'
import { useLatest } from 'react-use'

import { chainIdToDefaultL2ChainId, rpcURLs } from '../util/networks'
import { trackEvent } from '../util/AnalyticsUtils'
import { modalProviderOpts } from '../util/modelProviderOpts'

export enum UseNetworksAndSignersStatus {
  LOADING = 'loading',
  NOT_CONNECTED = 'not_connected',
  NOT_SUPPORTED = 'not_supported',
  CONNECTED = 'connected'
}

export type UseNetworksAndSignersLoadingOrErrorStatus =
  | UseNetworksAndSignersStatus.LOADING
  | UseNetworksAndSignersStatus.NOT_CONNECTED
  | UseNetworksAndSignersStatus.NOT_SUPPORTED

const defaultStatus =
  typeof window.web3 === 'undefined'
    ? UseNetworksAndSignersStatus.NOT_CONNECTED
    : UseNetworksAndSignersStatus.LOADING

type UseNetworksAndSignersLoadingOrErrorResult = {
  status: UseNetworksAndSignersLoadingOrErrorStatus
}

type UseNetworksAndSignersConnectedResult = {
  status: UseNetworksAndSignersStatus.CONNECTED
  l1: { network: L1Network; signer: JsonRpcSigner; provider: JsonRpcProvider }
  l2: { network: L2Network; signer: JsonRpcSigner; provider: JsonRpcProvider }
  isConnectedToArbitrum: boolean
}

export type UseNetworksAndSignersResult =
  | UseNetworksAndSignersLoadingOrErrorResult
  | UseNetworksAndSignersConnectedResult

export const NetworksAndSignersContext = createContext<
  UseNetworksAndSignersConnectedResult | undefined
>(undefined)

export function useNetworksAndSigners() {
  const context = useContext(NetworksAndSignersContext)

  if (typeof context === 'undefined') {
    throw new Error(
      'The useNetworksAndSigners Hook must only be used inside NetworksAndSignersContext.Provider.'
    )
  }

  return context
}

export type NetworksAndSignersProviderProps = {
  /**
   * Chooses a specific L2 chain in a situation where multiple L2 chains are connected to a single L1 chain.
   */
  selectedL2ChainId?: number
  /**
   * Render prop that gets called with the current status in case of anything other than a successful connection.
   *
   * @see https://reactjs.org/docs/render-props.html
   */
  fallback: (status: UseNetworksAndSignersLoadingOrErrorStatus) => JSX.Element
  /**
   * Renders on successful connection.
   */
  children: React.ReactNode
}

// TODO: maintain these wallet names in a central constants file (like networks.ts/wallet.ts) - can be consistently accessed all throughout the app?
export type ProviderName = 'MetaMask' | 'Coinbase Wallet' | 'WalletConnect'

function getProviderName(provider: any): ProviderName | null {
  if (provider.isMetaMask) {
    return 'MetaMask'
  }

  if (provider.isCoinbaseWallet) {
    return 'Coinbase Wallet'
  }

  if (provider.isWalletConnect) {
    return 'WalletConnect'
  }

  return null
}

export function NetworksAndSignersProvider(
  props: NetworksAndSignersProviderProps
): JSX.Element {
  const { selectedL2ChainId } = props
  const { provider, account, network, connect } = useWallet()

  const [result, setResult] = useState<UseNetworksAndSignersResult>({
    status: defaultStatus
  })
  const latestResult = useLatest(result)

  // Reset back to the not connected state in case the user manually disconnects through their wallet
  useEffect(() => {
    const connected = result.status === UseNetworksAndSignersStatus.CONNECTED

    if (connected && typeof account === 'undefined') {
      setResult({ status: UseNetworksAndSignersStatus.NOT_CONNECTED })
    }
  }, [account, result])

  // When user clicks on any of the wallets to connect at the start of the session
  useEffect(() => {
    async function tryConnect() {
      try {
        const connection = await connect(modalProviderOpts)
        const providerName = getProviderName(connection.provider.provider)

        if (providerName) {
          trackEvent(`Connect Wallet Click: ${providerName}`)
        }
      } catch (error) {
        setResult({ status: UseNetworksAndSignersStatus.NOT_CONNECTED })
      }
    }

    tryConnect()
  }, [connect])

  // TODO: Don't run all of this when an account switch happens. Just derive signers from networks?
  const update = useCallback(
    async (web3Provider: Web3Provider, address: string) => {
      const providerChainId = (await web3Provider.getNetwork()).chainId

      let _selectedL2ChainId = selectedL2ChainId
      if (_selectedL2ChainId === undefined) {
        // If l2ChainId is undefined, use a default L2 based on the connected provider chainid
        _selectedL2ChainId = chainIdToDefaultL2ChainId[providerChainId]
        if (_selectedL2ChainId === undefined) {
          console.error(`Unknown provider chainId: ${providerChainId}`)
          setResult({ status: UseNetworksAndSignersStatus.NOT_SUPPORTED })
          return
        }
      }

      getL1Network(web3Provider, _selectedL2ChainId!)
        .then(async l1Network => {
          // Web3Provider is connected to an L1 network. We instantiate a provider for the L2 network.
          const l2Provider = new JsonRpcProvider(rpcURLs[_selectedL2ChainId!])

          await addCustomNetwork({
            customL1Network: {
              "blockTime": 10,
              "chainID": 1337,
              "explorerUrl": "",
              "isCustom": true,
              "name": "EthLocal",
              "partnerChainIDs": [
                412346
              ],
              "rpcURL": "http://localhost:8545"
            },
            customL2Network: {
              "chainID": 412346,
              "confirmPeriodBlocks": 20,
              "ethBridge": {
                "bridge": "0xcaf1ded82e70c5af3d6585a1dcc3ff8f2ea42794",
                "inbox": "0xc2c8f6ec5fcb9a9aeea4116a521594bf40ab6408",
                "outbox": "0x86B30E87F64025085c7853E64355B97DE5D13393",
                "rollup": "0x71b4f5764d732ddd5e34a9d60b7bf9f87905e7ed",
                "sequencerInbox": "0x8cfc0044df41af12d4cbb6fd1c71aceafa503900"
              },
              "explorerUrl": "",
              "isArbitrum": true,
              "isCustom": true,
              "name": "ArbLocal",
              "partnerChainID": 1337,
              "rpcURL": "http://localhost:8547",
              "retryableLifetimeSeconds": 604800,
              "tokenBridge": {
                "l1CustomGateway": "0xDe67138B609Fbca38FcC2673Bbc5E33d26C5B584",
                "l1ERC20Gateway": "0x0Bdb0992B3872DF911260BfB60D72607eb22d5d4",
                "l1GatewayRouter": "0x4535771b8D5C43100f126EdACfEc7eb60d391312",
                "l1MultiCall": "0x36BeF5fD671f2aA8686023dE4797A7dae3082D5F",
                "l1ProxyAdmin": "0xF7818cd5f5Dc379965fD1C66b36C0C4D788E7cDB",
                "l1Weth": "0x24067223381F042fF36fb87818196dB4D2C56E9B",
                "l1WethGateway": "0xBa3d12E370a4b592AAF0CA1EF09971D196c27aAd",
                "l2CustomGateway": "0xF0B003F9247f2DC0e874710eD55e55f8C63B14a3",
                "l2ERC20Gateway": "0x78a6dC8D17027992230c112432E42EC3d6838d74",
                "l2GatewayRouter": "0x7b650845242a96595f3a9766D4e8e5ab0887936A",
                "l2Multicall": "0x9b890cA9dE3D317b165afA7DFb8C65f2e4c95C20",
                "l2ProxyAdmin": "0x7F85fB7f42A0c0D40431cc0f7DFDf88be6495e67",
                "l2Weth": "0x36BeF5fD671f2aA8686023dE4797A7dae3082D5F",
                "l2WethGateway": "0x2E76efCC2518CB801E5340d5f140B1c1911b4F4B"
              }
            }
          })

          const l2Network = await getL2Network(l2Provider)
          console.log(l2Network)

          // from the L1 network, instantiate the provider for that too
          // - done to feed into a consistent l1-l2 network-signer result state both having signer+providers
          const l1Provider = new JsonRpcProvider(rpcURLs[l1Network.chainID!])

          setResult({
            status: UseNetworksAndSignersStatus.CONNECTED,
            l1: {
              network: l1Network,
              signer: web3Provider.getSigner(0),
              provider: l1Provider
            },
            l2: {
              network: l2Network,
              signer: l2Provider.getSigner(address!),
              provider: l2Provider
            },
            isConnectedToArbitrum: false
          })
        })
        .catch(() => {
          // Web3Provider is connected to an L2 network. We instantiate a provider for the L1 network.
          if (providerChainId != _selectedL2ChainId) {
            // Make sure the L2 provider chainid match the selected chainid
            setResult({ status: UseNetworksAndSignersStatus.NOT_SUPPORTED })
            return
          }


          await addCustomNetwork({
            customL1Network: {
              "blockTime": 10,
              "chainID": 1337,
              "explorerUrl": "",
              "isCustom": true,
              "name": "EthLocal",
              "partnerChainIDs": [
                412346
              ],
              "rpcURL": "http://localhost:8545"
            },
            customL2Network: {
              "chainID": 412346,
              "confirmPeriodBlocks": 20,
              "ethBridge": {
                "bridge": "0xcaf1ded82e70c5af3d6585a1dcc3ff8f2ea42794",
                "inbox": "0xc2c8f6ec5fcb9a9aeea4116a521594bf40ab6408",
                "outbox": "0x86B30E87F64025085c7853E64355B97DE5D13393",
                "rollup": "0x71b4f5764d732ddd5e34a9d60b7bf9f87905e7ed",
                "sequencerInbox": "0x8cfc0044df41af12d4cbb6fd1c71aceafa503900"
              },
              "explorerUrl": "",
              "isArbitrum": true,
              "isCustom": true,
              "name": "ArbLocal",
              "partnerChainID": 1337,
              "rpcURL": "http://localhost:8547",
              "retryableLifetimeSeconds": 604800,
              "tokenBridge": {
                "l1CustomGateway": "0xDe67138B609Fbca38FcC2673Bbc5E33d26C5B584",
                "l1ERC20Gateway": "0x0Bdb0992B3872DF911260BfB60D72607eb22d5d4",
                "l1GatewayRouter": "0x4535771b8D5C43100f126EdACfEc7eb60d391312",
                "l1MultiCall": "0x36BeF5fD671f2aA8686023dE4797A7dae3082D5F",
                "l1ProxyAdmin": "0xF7818cd5f5Dc379965fD1C66b36C0C4D788E7cDB",
                "l1Weth": "0x24067223381F042fF36fb87818196dB4D2C56E9B",
                "l1WethGateway": "0xBa3d12E370a4b592AAF0CA1EF09971D196c27aAd",
                "l2CustomGateway": "0xF0B003F9247f2DC0e874710eD55e55f8C63B14a3",
                "l2ERC20Gateway": "0x78a6dC8D17027992230c112432E42EC3d6838d74",
                "l2GatewayRouter": "0x7b650845242a96595f3a9766D4e8e5ab0887936A",
                "l2Multicall": "0x9b890cA9dE3D317b165afA7DFb8C65f2e4c95C20",
                "l2ProxyAdmin": "0x7F85fB7f42A0c0D40431cc0f7DFDf88be6495e67",
                "l2Weth": "0x36BeF5fD671f2aA8686023dE4797A7dae3082D5F",
                "l2WethGateway": "0x2E76efCC2518CB801E5340d5f140B1c1911b4F4B"
              }
            }
          })

          getL2Network(web3Provider)
            .then(async l2Network => {
              console.log(l2Network)

              const l1NetworkChainId = l2Network.partnerChainID
              const l1Provider = new JsonRpcProvider(rpcURLs[l1NetworkChainId])
              const l1Network = await getL1Network(
                l1Provider,
                _selectedL2ChainId!
              )

              const l2Provider = new JsonRpcProvider(
                rpcURLs[l2Network.chainID!]
              )

              setResult({
                status: UseNetworksAndSignersStatus.CONNECTED,
                l1: {
                  network: l1Network,
                  signer: l1Provider.getSigner(address!),
                  provider: l1Provider
                },
                l2: {
                  network: l2Network,
                  signer: web3Provider.getSigner(0),
                  provider: l2Provider
                },
                isConnectedToArbitrum: true
              })
            })
            .catch(() => {
              setResult({ status: UseNetworksAndSignersStatus.NOT_SUPPORTED })
            })
        })
    },
    [latestResult, selectedL2ChainId]
  )

  useEffect(() => {
    if (provider && account && network) {
      update(provider, account)
    }
    // The `network` object has to be in the list of dependencies for switching between L1-L2 pairs.
  }, [provider, account, network, update])

  if (result.status !== UseNetworksAndSignersStatus.CONNECTED) {
    return props.fallback(result.status)
  }

  return (
    <NetworksAndSignersContext.Provider value={result}>
      {props.children}
    </NetworksAndSignersContext.Provider>
  )
}
