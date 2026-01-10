const numberFormatter = new Intl.NumberFormat('en-US');
const priceFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

export const formatNumber = (value: number) => numberFormatter.format(value);

export const formatPrice = (value: number) => priceFormatter.format(value);

export const formatDateTime = (timestamp?: number) => {
  if (!timestamp) return 'Unknown time';
  const date = new Date(timestamp);
  return date.toLocaleString();
};

export const formatRelativeTime = (timestamp?: number) => {
  if (!timestamp) return 'time unknown';
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

export const shortenAddress = (value: string, visible = 6) =>
  value.length <= visible * 2
    ? value
    : `${value.slice(0, visible)}…${value.slice(-visible)}`;
