import { useState } from 'react';
import './App.css';
import { DEFAULT_POOL_ID, ORACLE_POOLS } from './config';
import { PoolDashboard } from './components/PoolDashboard';
import { clearPoolCaches } from './services/poolCache';
import { loadSettings, normalizeSettings, saveSettings } from './settings';

function App() {
  const [selectedPoolId, setSelectedPoolId] = useState(DEFAULT_POOL_ID);
  const [settings, setSettings] = useState(loadSettings);
  /** Bumped when the cache is cleared, remounting the dashboard so it reloads from the node. */
  const [cacheGeneration, setCacheGeneration] = useState(0);
  const pool = ORACLE_POOLS.find((candidate) => candidate.id === selectedPoolId) ?? ORACLE_POOLS[0];

  if (!pool) {
    return <div className="page">No oracle pools configured.</div>;
  }

  return (
    <PoolDashboard
      key={`${pool.id}|${settings.nodeUrl}|${cacheGeneration}`}
      pools={ORACLE_POOLS}
      pool={pool}
      onSelectPool={setSelectedPoolId}
      settings={settings}
      onSettingsChange={(next) => {
        const normalized = normalizeSettings(next);
        setSettings(normalized);
        saveSettings(normalized);
      }}
      onClearCache={() => {
        clearPoolCaches();
        setCacheGeneration((value) => value + 1);
      }}
    />
  );
}

export default App;
