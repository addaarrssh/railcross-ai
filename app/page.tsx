import RailCrossMap from "./RailCrossMap";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <RailCrossMap
      apiKey={process.env.GOOGLE_MAPS_API_KEY ?? ""}
    />
  );
}
