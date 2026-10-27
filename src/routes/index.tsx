import { createFileRoute } from "@tanstack/react-router";
import { Chalkline } from "@/components/chalkline";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <Chalkline />;
}
