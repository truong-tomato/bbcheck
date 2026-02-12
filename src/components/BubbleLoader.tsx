interface BubbleLoaderProps {
  label: string;
  compact?: boolean;
}

export function BubbleLoader({ label, compact = false }: BubbleLoaderProps): JSX.Element {
  return (
    <div className={`bubbleLoader ${compact ? "compact" : ""}`} role="status" aria-live="polite">
      <div className="bubbleLoaderTrack" aria-hidden>
        <span className="liveBubble bubbleA" />
        <span className="liveBubble bubbleB" />
        <span className="liveBubble bubbleC" />
      </div>
      <p>{label}</p>
    </div>
  );
}
