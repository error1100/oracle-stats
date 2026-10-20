const numberFormatter = new Intl.NumberFormat('en-US');
const quoteFormatter = new Intl.NumberFormat('en-US', {
  minimumSignificantDigits: 6,
  maximumSignificantDigits: 6,
});

export const formatNumber = (value: number) => numberFormatter.format(value);

/** Pool rates are nanoERG per quote unit; the displayed price is quote units per ERG. */
export const quoteFromRate = (rate: number) => 1_000_000_000 / rate;

export const formatQuote = (rate: number | null) =>
  rate ? quoteFormatter.format(quoteFromRate(rate)) : '—';

export const formatSignedPercent = (value: number, digits = 2) =>
  `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}%`;

export const shortenAddress = (value: string, visible = 6) =>
  value.length <= visible * 2
    ? value
    : `${value.slice(0, visible)}…${value.slice(-visible)}`;
