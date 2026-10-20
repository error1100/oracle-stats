import { useEffect, useRef, useState } from 'react';
import { DEFAULT_ERGO_NODE_URL, MIN_REFRESH_INTERVAL_SECONDS, type OraclePoolConfig } from '../config';
import { DEFAULT_SETTINGS, type Settings } from '../settings';
import { formatNumber, formatQuote } from '../utils/format';

interface TopBarProps {
  pools: OraclePoolConfig[];
  selectedPool: OraclePoolConfig;
  onSelectPool: (poolId: string) => void;
  rate: number | null;
  epochId: number | null;
  height: number | null;
  secondsUntilNextCheck: number | null;
  isLoading: boolean;
  error: string | null;
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  onClearCache: () => void;
}

const SettingsMenu = ({
  settings,
  onSettingsChange,
  onClearCache,
}: Pick<TopBarProps, 'settings' | 'onSettingsChange' | 'onClearCache'>) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(settings);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="settings" ref={rootRef}>
      <button
        type="button"
        className="icon-button"
        aria-expanded={open}
        aria-label="Settings"
        title="Settings"
        onClick={() => {
          setDraft(settings);
          setOpen((value) => !value);
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open && (
        <form
          className="settings-panel"
          onSubmit={(event) => {
            event.preventDefault();
            onSettingsChange(draft);
            setOpen(false);
          }}
        >
          <label htmlFor="node-url-input">Ergo node URL</label>
          <input
            id="node-url-input"
            type="url"
            value={draft.nodeUrl}
            onChange={(event) => setDraft({ ...draft, nodeUrl: event.target.value })}
            spellCheck={false}
            autoFocus
            placeholder={DEFAULT_ERGO_NODE_URL}
          />
          <p className="note">Needs the blockchain indexer API.</p>
          <label className="toggle">
            <input
              type="checkbox"
              checked={draft.autoRefresh}
              onChange={(event) => setDraft({ ...draft, autoRefresh: event.target.checked })}
            />
            Auto-refresh every
            <input
              id="refresh-interval-input"
              className="interval"
              type="number"
              min={MIN_REFRESH_INTERVAL_SECONDS}
              step={1}
              value={draft.refreshIntervalSeconds}
              disabled={!draft.autoRefresh}
              onChange={(event) => setDraft({ ...draft, refreshIntervalSeconds: event.target.valueAsNumber })}
            />
            s
          </label>
          <p className="note">Checks the node for a new block and merges new datapoints. Settings are saved in this browser.</p>
          <div className="settings-cache">
            <span className="note">Loaded epochs are cached in this browser.</span>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                onClearCache();
                setOpen(false);
              }}
            >
              Clear cache
            </button>
          </div>
          <div className="settings-actions">
            <button type="button" className="ghost" onClick={() => setDraft(DEFAULT_SETTINGS)}>
              Defaults
            </button>
            <button type="submit" className="primary">
              Save
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export const TopBar = ({
  pools,
  selectedPool,
  onSelectPool,
  rate,
  epochId,
  height,
  secondsUntilNextCheck,
  isLoading,
  error,
  settings,
  onSettingsChange,
  onClearCache,
}: TopBarProps) => (
  <header className="topbar">
    <nav className="pool-tabs" aria-label="Oracle pool">
      {pools.map((pool) => (
        <button
          key={pool.id}
          type="button"
          className={`pool-tab ${pool.id === selectedPool.id ? 'on' : ''}`}
          onClick={() => onSelectPool(pool.id)}
          title={pool.description}
        >
          {pool.label}
        </button>
      ))}
    </nav>
    <span className="price">
      {formatQuote(rate)} {selectedPool.quoteTicker ?? 'USD'}/ERG
    </span>
    <span className="meta">
      rate {rate ?? '—'} · epoch {epochId ?? '—'} · block {height !== null ? formatNumber(height) : '—'}
    </span>
    <span className="live" title={error ?? `Node: ${settings.nodeUrl}`}>
      <span className={`live-dot ${error ? 'down' : settings.autoRefresh ? '' : 'paused'}`} />
      {error
        ? 'node error'
        : isLoading
          ? 'loading…'
          : !settings.autoRefresh
            ? 'auto-refresh off'
            : secondsUntilNextCheck !== null
              ? `next check ${secondsUntilNextCheck}s`
              : 'live'}
    </span>
    <SettingsMenu settings={settings} onSettingsChange={onSettingsChange} onClearCache={onClearCache} />
  </header>
);
