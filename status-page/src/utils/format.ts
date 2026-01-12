const numberFormatter = new Intl.NumberFormat('en-US');
const priceFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

export const formatNumber = (value: number) => numberFormatter.format(value);

export const formatPrice = (value: number) => priceFormatter.format(value);

export const shortenAddress = (value: string, visible = 6) =>
  value.length <= visible * 2
    ? value
    : `${value.slice(0, visible)}…${value.slice(-visible)}`;
