import { greetingForHour } from "@/lib/dashboard/format";

interface GreetingStackProps {
  /** Rendered on the server, so this is the server's clock. */
  hour: number;
  statement: string;
}

/** Two centered lines: muted salutation above the near-black statement. */
export function GreetingStack({ hour, statement }: GreetingStackProps) {
  return (
    <div className="text-center">
      <p className="greeting">{greetingForHour(hour)}!</p>
      <p className="statement mt-1 text-balance">{statement}</p>
    </div>
  );
}
