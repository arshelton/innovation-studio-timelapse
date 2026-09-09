import type { Location } from "../types";

interface Props {
  locations: Location[];
  availableLocationIds: ReadonlySet<string>;

  activeLocationId: string | null;

  onChange: (locationId: string) => void;
}

export function LocationTabs({
  locations,
  availableLocationIds,
  activeLocationId,
  onChange,
}: Props) {
  return (
    <nav className="location-tabs" aria-label="Panorama locations">
      {locations.map((location) => {
        const available = availableLocationIds.has(location.id);

        const active = activeLocationId === location.id;

        return (
          <button
            key={location.id}
            type="button"
            className={["location-tab", active ? "location-tab--active" : ""]
              .filter(Boolean)
              .join(" ")}
            disabled={!available}
            aria-pressed={active}
            title={
              available
                ? `View ${location.name}`
                : `${location.name} has no image near this time`
            }
            onClick={() => {
              onChange(location.id);
            }}
          >
            {location.name}
          </button>
        );
      })}
    </nav>
  );
}
