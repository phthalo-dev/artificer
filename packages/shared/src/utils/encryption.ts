import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const KEY_LENGTH = 32;

/**
 * Encrypts text using AES-256-GCM
 * @param text - Plain text to encrypt
 * @param masterKey - Master encryption key (should be from env variable)
 * @returns Encrypted text in format: salt:iv:encrypted:authTag (all base64)
 */
export function encrypt(text: string, masterKey: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = crypto.pbkdf2Sync(masterKey, salt, 100000, KEY_LENGTH, 'sha256');
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  return [
    salt.toString('base64'),
    iv.toString('base64'),
    encrypted,
    authTag.toString('base64'),
  ].join(':');
}

/**
 * Decrypts text encrypted with encrypt()
 * @param encryptedText - Encrypted text in format: salt:iv:encrypted:authTag
 * @param masterKey - Master encryption key (same as used for encryption)
 * @returns Decrypted plain text
 */
export function decrypt(encryptedText: string, masterKey: string): string {
  const parts = encryptedText.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted text format');
  }

  const [saltB64, ivB64, encrypted, authTagB64] = parts;

  const salt = Buffer.from(saltB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');

  const key = crypto.pbkdf2Sync(masterKey, salt, 100000, KEY_LENGTH, 'sha256');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Generates a random encryption key
 * @returns Random key as hex string
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(KEY_LENGTH).toString('hex');
}
