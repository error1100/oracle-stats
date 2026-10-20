import { useState } from 'react';
import './App.css';
import { DEFAULT_ERGO_NODE_URL, DEFAULT_POOL_ID, ORACLE_POOLS } from './config';
import { PoolDashboard } from './components/PoolDashboard';

const NODE_URL_STORAGE_KEY = 'oracle-stats.nodeUrl';

const normalizeNodeUrl = (value: string) => value.trim().replace(/\/+$/, '') || DEFAULT_ERGO_NODE_URL;

const loadStoredNodeUrl = () => {
  try {
    return normalizeNodeUrl(window.localStorage.getItem(NODE_URL_STORAGE_KEY) ?? '');
  } catch {
    return DEFAULT_ERGO_NODE_URL;
  }
};

function App() {
  const [selectedPoolId, setSelectedPoolId] = useState(DEFAULT_POOL_ID);
  const [nodeUrl, setNodeUrl] = useState(loadStoredNodeUrl);
  const pool = ORACLE_POOLS.find((candidate) => candidate.id === selectedPoolId) ?? ORACLE_POOLS[0];

  if (!pool) {
    return <div className="page">No oracle pools configured.</div>;
  }

  return (
    <PoolDashboard
      key={`${pool.id}|${nodeUrl}`}
      pools={ORACLE_POOLS}
      pool={pool}
      onSelectPool={setSelectedPoolId}
      nodeUrl={nodeUrl}
      onNodeUrlChange={(value) => {
        const normalized = normalizeNodeUrl(value);
        setNodeUrl(normalized);
        try {
          window.localStorage.setItem(NODE_URL_STORAGE_KEY, normalized);
        } catch (error) {
          console.error('Failed to persist node URL', error);
        }
      }}
    />
  );
}

export default App;
