interface Props {
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}

function TimelineSlider({ min, max, value, onChange }: Props) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ width: "100%" }}
    />
  );
}

export default TimelineSlider;
