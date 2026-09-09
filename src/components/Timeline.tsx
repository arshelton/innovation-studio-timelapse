interface Props {
  minimumTime: number;
  maximumTime: number;
  selectedTime: number;
  selectedTimeLabel: string;
  frameLabel: string;
  onChange: (timestamp: number) => void;
  onPreviousFrame: () => void;
  onNextFrame: () => void;
}

export function Timeline({
  minimumTime,
  maximumTime,
  selectedTime,
  selectedTimeLabel,
  frameLabel,
  onChange,
  onPreviousFrame,
  onNextFrame,
}: Props) {
  return (
    <section className="timeline-panel" aria-label="Panorama timeline">
      <div className="timeline-header">
        <div>
          <p className="timeline-eyebrow">Selected time</p>

          <time dateTime={new Date(selectedTime).toISOString()}>
            {selectedTimeLabel}
          </time>
        </div>

        <span className="frame-label">{frameLabel}</span>
      </div>

      <div className="timeline-controls">
        <button
          type="button"
          className="secondary-button"
          onClick={onPreviousFrame}
        >
          Previous
        </button>

        <input
          type="range"
          className="timeline-input"
          aria-label="Selected panorama time"
          min={minimumTime}
          max={maximumTime}
          step={1000}
          value={selectedTime}
          onChange={(event) => {
            onChange(Number(event.target.value));
          }}
        />

        <button
          type="button"
          className="secondary-button"
          onClick={onNextFrame}
        >
          Next
        </button>
      </div>

      <div className="timeline-boundaries">
        <time dateTime={new Date(minimumTime).toISOString()}>
          {new Date(minimumTime).toLocaleString()}
        </time>

        <time dateTime={new Date(maximumTime).toISOString()}>
          {new Date(maximumTime).toLocaleString()}
        </time>
      </div>
    </section>
  );
}
