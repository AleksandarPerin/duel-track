'use strict';

/**
 * Enforce that all stored emails are already lowercased.
 * The application layer (Zod) lowercases emails on ingress; this constraint
 * adds a DB-level guarantee so direct inserts and future data imports cannot
 * introduce mixed-case duplicates that evade the UNIQUE index.
 */
exports.up = (pgm) => {
  pgm.addConstraint('users', 'email_is_lowercase', 'CHECK (email = lower(email))');
};

exports.down = (pgm) => {
  pgm.dropConstraint('users', 'email_is_lowercase');
};
