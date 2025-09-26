import { createFileRoute, notFound } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";

const getEnv = createIsomorphicFn().server(() => "hello");

export const Route = createFileRoute("/user/$id")({
  component: RouteComponent,
  pendingComponent: () => <p>Loading...</p>,
  notFoundComponent: () => <h1>This is not a user page.</h1>,
  errorComponent: ({ error }) => (
    <p className="text-red-400">This is error. {error.message}</p>
  ),
  loader: async ({ params }) => {
    const res = await fetch(
      `https://jsonplaceholder.typicode.com/users/${params.id}`
    );

    if (!res.ok) {
      throw new Error("Failed to fetch users");
    }

    const user = await res.json();

    console.log("getEnv:", getEnv());

    if (!user.id) {
      throw notFound();
    }

    return { user };
  }
});

function RouteComponent() {
  const { id } = Route.useParams();
  const data = Route.useLoaderData();

  console.log(data);

  return <div>Hello "/user" {id}!</div>;
}
