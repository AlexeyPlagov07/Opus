/**
 * Express request augmentation declarations.
 *
 * Extends Express.Request so authentication middleware can attach user
 * identity data consumed by protected route handlers.
 */
declare namespace Express {
  interface Request {
    user?: {
      uid: string;
      email: string | null;
    };
  }
}
