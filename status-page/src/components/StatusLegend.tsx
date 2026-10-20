const ITEMS: Array<{ className: string; label: string; title: string }> = [
  { className: 'included', label: 'included', title: 'Consumed by the refresh' },
  { className: 'included repost', label: 'reposted', title: 'Oracle posted again in the same epoch; the last post was included' },
  { className: 'included bottleneck', label: 'bottleneck', title: 'First datapoint arrived last in an overrun epoch' },
  { className: 'late', label: 'late', title: 'Posted at or after the refresh block' },
  { className: 'rejected', label: 'rejected', title: 'Posted in time but not consumed by the refresh' },
  { className: 'absent', label: 'absent', title: 'No datapoint in this epoch' },
  { className: 'pending', label: 'pending', title: 'Posted; epoch still open' },
  { className: 'awaiting', label: 'awaiting', title: 'Not posted yet; epoch still open' },
];

export const StatusLegend = () => (
  <div className="legend">
    {ITEMS.map((item) => (
      <span key={item.label} title={item.title}>
        <i className={`glyph ${item.className}`} />
        {item.label}
      </span>
    ))}
  </div>
);
