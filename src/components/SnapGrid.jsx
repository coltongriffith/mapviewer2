export default function SnapGrid({ active, containerRef }) {
  if (!active || !containerRef.current) return null;
  const W = containerRef.current.offsetWidth;
  const H = containerRef.current.offsetHeight;

  return (
    <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 2000 }} xmlns="http://www.w3.org/2000/svg">
      {[0.25, 0.33, 0.5, 0.66, 0.75].map((f) => (
        <g key={f}>
          <line x1={W * f} y1={0} x2={W * f} y2={H} stroke="rgba(100,180,255,0.18)" strokeWidth="1" strokeDasharray="4,4" />
          <line x1={0} y1={H * f} x2={W} y2={H * f} stroke="rgba(100,180,255,0.18)" strokeWidth="1" strokeDasharray="4,4" />
        </g>
      ))}
      <line x1={W / 2} y1={0} x2={W / 2} y2={H} stroke="rgba(100,200,255,0.28)" strokeWidth="1" />
      <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="rgba(100,200,255,0.28)" strokeWidth="1" />
    </svg>
  );
}
