interface TimelineProps {
  selectedIndex: number;
  totalSessions: number;

  selectedDateLabel: string;
  frameLabel: string;

  onChange: (sessionIndex: number) => void;

  onPrevious: () => void;
  onNext: () => void;
}

export function Timeline({
  selectedIndex,
  totalSessions,
  selectedDateLabel,
  frameLabel,
  onChange,
  onPrevious,
  onNext,
}: TimelineProps) {
  const previousDisabled = selectedIndex <= 0;

  const nextDisabled = selectedIndex >= totalSessions - 1;

  return (
    <section className="timeline-panel" aria-label="Capture timeline">
      <div className="timeline-header">
        <div>
          <p className="timeline-eyebrow">Capture session</p>

          <span>{selectedDateLabel}</span>
        </div>

        <span className="frame-label">{frameLabel}</span>
      </div>

      <div className="timeline-controls">
        <button
          type="button"
          className="secondary-button"
          disabled={previousDisabled}
          onClick={onPrevious}
        >
          Previous
        </button>

        <input
          type="range"
          className="timeline-input"
          aria-label="Selected capture session"
          min={0}
          max={Math.max(0, totalSessions - 1)}
          step={1}
          value={selectedIndex}
          onChange={(event) => {
            onChange(Number(event.target.value));
          }}
        />

        <button
          type="button"
          className="secondary-button"
          disabled={nextDisabled}
          onClick={onNext}
        >
          Next
        </button>
      </div>

      <div className="timeline-position">
        Session {selectedIndex + 1} of {totalSessions}
      </div>
    </section>
  );
}
