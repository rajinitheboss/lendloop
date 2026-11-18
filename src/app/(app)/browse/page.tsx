import { BrowseView } from "./browse-view";

// Personal, realtime data rendered in the browser: no static shell to validate.
export const instant = false;

export default function BrowsePage() {
  return <BrowseView />;
}
