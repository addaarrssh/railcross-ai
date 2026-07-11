# Google Routes Data Contract

RailCross does not receive raw phone locations, device counts, vehicle counts, stopped-vehicle ratios, or an authoritative gate status from Google. Its model schema is limited to route fields available from the Google Routes API and values calculated from repeated polls.

## Raw Google Routes fields

For each approach, the poller requests:

- `routes.duration`: traffic-aware travel duration;
- `routes.staticDuration`: duration without current traffic;
- `routes.travelAdvisory.speedReadingIntervals`: `NORMAL`, `SLOW`, or `TRAFFIC_JAM` segments.

The API request enables `TRAFFIC_ON_POLYLINE` and asks for those fields explicitly. See the official [traffic-on-polylines guide](https://developers.google.com/maps/documentation/routes/traffic_on_polylines) and [Compute Routes reference](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes).

## Derived fields

RailCross calculates these from a history of repeated route polls:

- `traffic_delay_seconds = duration - staticDuration`;
- `both_approaches_jammed`: both approach segments report `TRAFFIC_JAM`;
- `traffic_delay_change_1min_seconds`: change in traffic delay across one minute;
- `both_approaches_jammed_minutes`: continuous duration of a two-sided traffic jam;
- three- and ten-minute rolling traffic-delay averages.

These fields are feasible to collect in a real pilot. They are still indirect evidence of a gate closure: accidents, markets, signals, weather, and other road disruptions can produce similar traffic.

## Synthetic benchmark boundary

The current CSV is a simulator-generated dataset with the same field names and data shapes as this contract. It is not copied Google data. A real accuracy claim requires independently observed gate labels matched to the route polls.
