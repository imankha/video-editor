import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function UserPicker({ emails, onChange, contacts, placeholder }) {
  const [inputValue, setInputValue] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  const filteredContacts = contacts.filter(
    (c) => !emails.includes(c) && c.includes(inputValue.toLowerCase())
  );

  useEffect(() => {
    setHighlightIndex(-1);
  }, [inputValue]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const addEmail = useCallback((email) => {
    const normalized = email.trim().toLowerCase();
    if (!normalized || !EMAIL_REGEX.test(normalized)) return false;
    if (emails.includes(normalized)) return false;
    onChange([...emails, normalized]);
    setInputValue('');
    setShowDropdown(false);
    return true;
  }, [emails, onChange]);

  const removeEmail = useCallback((email) => {
    onChange(emails.filter((e) => e !== email));
    inputRef.current?.focus();
  }, [emails, onChange]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (highlightIndex >= 0 && highlightIndex < filteredContacts.length) {
        addEmail(filteredContacts[highlightIndex]);
      } else if (inputValue.trim()) {
        addEmail(inputValue);
      }
      return;
    }
    if (e.key === 'Backspace' && !inputValue && emails.length > 0) {
      removeEmail(emails[emails.length - 1]);
      return;
    }
    if (e.key === 'Escape') {
      setShowDropdown(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, filteredContacts.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
      return;
    }
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    if (val.includes(',') || val.includes(';')) {
      const parts = val.split(/[,;]/);
      const toAdd = parts
        .slice(0, -1)
        .map((p) => p.trim().toLowerCase())
        .filter((p) => p && EMAIL_REGEX.test(p) && !emails.includes(p));
      if (toAdd.length > 0) {
        const deduped = [...new Set(toAdd)];
        onChange([...emails, ...deduped]);
      }
      setInputValue(parts[parts.length - 1] || '');
      return;
    }
    setInputValue(val);
    setShowDropdown(true);
  };

  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex flex-wrap items-center gap-1.5 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 min-h-[38px] cursor-text focus-within:border-cyan-500"
        onClick={() => inputRef.current?.focus()}
      >
        {emails.map((email) => (
          <span
            key={email}
            className="flex items-center gap-1 bg-gray-600 text-gray-200 text-sm px-2 py-0.5 rounded"
          >
            {email}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeEmail(email); }}
              className="text-gray-400 hover:text-white"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowDropdown(true)}
          placeholder={emails.length === 0 ? (placeholder || 'Enter emails, separated by commas') : ''}
          className="flex-1 min-w-[120px] bg-transparent text-white placeholder-gray-500 text-sm outline-none py-0.5"
        />
      </div>

      {showDropdown && filteredContacts.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-gray-700 border border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {filteredContacts.map((contact, i) => (
            <button
              key={contact}
              type="button"
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                i === highlightIndex
                  ? 'bg-cyan-600 text-white'
                  : 'text-gray-300 hover:bg-gray-600'
              }`}
              onMouseDown={(e) => { e.preventDefault(); addEmail(contact); }}
              onMouseEnter={() => setHighlightIndex(i)}
            >
              {contact}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
