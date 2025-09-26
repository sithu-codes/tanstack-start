import { zValidator } from "@hono/zod-validator";
import argon2 from "argon2";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { generateId, type User } from "lucia";
import postgres from "postgres";

import { loginSchema } from "@/shared/schemas";
import type { SuccessResponse } from "@/shared/types";

import type { Context } from "../context";
import { db } from "../db";
import { userTable } from "../db/tables";
import { lucia } from "../lucia";
import { loggedIn } from "../middlewares/logged-in";

export const authRoute = new Hono<Context>()
  .post("/signup", zValidator("form", loginSchema), async (c) => {
    const { username, password } = c.req.valid("form");
    const passwordHash = await argon2.hash(password);

    const userId = generateId(15);

    try {
      await db.insert(userTable).values({ id: userId, username, passwordHash });

      const session = await lucia.createSession(userId, { username });
      const sessionCookie = lucia.createSessionCookie(session.id).serialize();

      c.header("Set-Cookie", sessionCookie, { append: true });

      return c.json<SuccessResponse>(
        {
          success: true,
          message: "User Created"
        },
        201
      );
    } catch (error) {
      if (error instanceof postgres.PostgresError && error.code === "23505") {
        throw new HTTPException(409, { message: "Username already used" });
      }

      throw new HTTPException(500, {
        message: "Failed to create user"
      });
    }
  })
  .post("/login", zValidator("form", loginSchema), async (c) => {
    const { username, password } = c.req.valid("form");

    const [existingUser] = await db
      .select()
      .from(userTable)
      .where(eq(userTable.username, username))
      .limit(1);

    if (!existingUser) {
      throw new HTTPException(401, { message: "Incorrect username" });
    }

    const validPassword = await argon2.verify(
      password,
      existingUser.passwordHash
    );

    if (!validPassword) {
      throw new HTTPException(401, { message: "Incorrect password" });
    }

    const session = await lucia.createSession(existingUser.id, { username });
    const sessionCookie = lucia.createSessionCookie(session.id).serialize();

    c.header("Set-Cookie", sessionCookie, { append: true });

    return c.json<SuccessResponse>(
      {
        success: true,
        message: "Logged In"
      },
      200
    );
  })
  .get("/logout", async (c) => {
    const session = c.get("session");
    if (!session) {
      return c.redirect("/");
    }

    await lucia.invalidateSession(session.id);

    c.header("Set-Cookie", lucia.createBlankSessionCookie().serialize(), {
      append: true
    });

    return c.redirect("/");
  })
  .get("/user", loggedIn, async (c) => {
    const user = c.get("user") as User;

    return c.json<SuccessResponse<User>>({
      success: true,
      message: "User fetched",
      data: user
    });
  });
