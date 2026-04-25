import ModelBrowser from "@/components/model-browser";
import { loadModelBrowserData } from "@/lib/model-data";

export default async function HomePage() {
  const data = await loadModelBrowserData();

  return <ModelBrowser data={data} />;
}
