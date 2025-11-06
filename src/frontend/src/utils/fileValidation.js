/**
 * File validation utilities
 */

// Supported video formats
const SUPPORTED_FORMATS = ['mp4', 'mov', 'webm'];
const SUPPORTED_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm'
];

// Maximum file size: 4GB
const MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024;

/**
 * Validate if file is a supported video format
 * @param {File} file - File to validate
 * @returns {Object} Validation result with isValid boolean and error message
 */
export function validateVideoFile(file) {
  if (!file) {
    return {
      isValid: false,
      error: 'No file selected'
    };
  }

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return {
      isValid: false,
      error: 'File is too large. Maximum size is 4GB.'
    };
  }

  // Check MIME type
  if (!SUPPORTED_MIME_TYPES.includes(file.type)) {
    return {
      isValid: false,
      error: `This file format is not supported. Please use ${SUPPORTED_FORMATS.join(', ').toUpperCase()}.`
    };
  }

  // Check file extension
  const extension = file.name.split('.').pop().toLowerCase();
  if (!SUPPORTED_FORMATS.includes(extension)) {
    return {
      isValid: false,
      error: `This file format is not supported. Please use ${SUPPORTED_FORMATS.join(', ').toUpperCase()}.`
    };
  }

  return {
    isValid: true,
    error: null
  };
}

/**
 * Check if file is a video based on MIME type
 * @param {File} file - File to check
 * @returns {boolean} True if file is a video
 */
export function isVideoFile(file) {
  return file && file.type.startsWith('video/');
}

/**
 * Get human-readable file size
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted file size
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}
