import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";

import type { ErrorResponse } from "@/shared/types";

import type { Context } from "./context";
import { lucia } from "./lucia";
import { authRoute, commentRoute, postRoute } from "./routes";
import { isProd } from "./utils";

const app = new Hono<Context>();

app.use("*", cors(), async (c, next) => {
  const sessionId = lucia.readSessionCookie(c.req.header("Cookie") ?? "");
  if (!sessionId) {
    c.set("user", null);
    c.set("session", null);

    return next();
  }

  const { session, user } = await lucia.validateSession(sessionId);
  if (session?.fresh) {
    c.header("Set-Cookie", lucia.createSessionCookie(session.id).serialize(), {
      append: true
    });
  }
  if (!session) {
    c.header("Set-Cookie", lucia.createBlankSessionCookie().serialize(), {
      append: true
    });
  }

  c.set("user", user);
  c.set("session", session);

  return next();
});

const routes = app
  .basePath("/api")
  .route("/auth", authRoute)
  .route("/comment", commentRoute)
  .route("/post", postRoute);

if (!isProd) {
  import("@hono/node-server").then(({ serve }) => {
    serve({ fetch: app.fetch, port: 3000 }, (info) => {
      console.log(`Server running on http://localhost:${info.port}`);
    });
  });
}

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    const errResponse =
      err.res ??
      c.json<ErrorResponse>(
        {
          success: false,
          error: err.message,
          isFormError:
            err.cause && typeof err.cause === "object" && "form" in err.cause
              ? err.cause.form === true
              : false
        },
        err.status
      );

    return errResponse;
  }

  return c.json<ErrorResponse>(
    {
      success: false,
      error: isProd ? "Internal Server Error" : (err.stack ?? err.message)
    },
    500
  );
});

export default app;
export type ApiRoutes = typeof routes;
