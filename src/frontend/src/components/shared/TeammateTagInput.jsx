import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';

let _uncommittedText = '';

export function hasUncommittedTeammateText() {
  return _uncommittedText.trim().length > 0;
}

export function TeammateTagInput({ teammates, onChange, suggestions, placeholder }) {
  const [inputValue, setInputValue] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    _uncommittedText = inputValue;
    return () => { _uncommittedText = ''; };
  }, [inputValue]);

  const filteredSuggestions = (suggestions || []).filter(
    (s) => !teammates.some((t) => t.toLowerCase() === s.toLowerCase()) &&
      s.toLowerCase().includes(inputValue.toLowerCase())
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

  const addTeammate = useCallback((name) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    if (teammates.some((t) => t.toLowerCase() === trimmed.toLowerCase())) return false;
    onChange([...teammates, trimmed]);
    setInputValue('');
    setShowDropdown(false);
    return true;
  }, [teammates, onChange]);

  const removeTeammate = useCallback((name) => {
    onChange(teammates.filter((t) => t !== name));
    inputRef.current?.focus();
  }, [teammates, onChange]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (highlightIndex >= 0 && highlightIndex < filteredSuggestions.length) {
        addTeammate(filteredSuggestions[highlightIndex]);
      } else if (inputValue.trim()) {
        addTeammate(inputValue);
      }
      return;
    }
    if (e.key === 'Backspace' && !inputValue && teammates.length > 0) {
      removeTeammate(teammates[teammates.length - 1]);
      return;
    }
    if (e.key === 'Escape') {
      setShowDropdown(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, filteredSuggestions.length - 1));
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
    if (val.includes(',')) {
      const parts = val.split(',');
      const toAdd = parts
        .slice(0, -1)
        .map((p) => p.trim())
        .filter((p) => p && !teammates.some((t) => t.toLowerCase() === p.toLowerCase()));
      if (toAdd.length > 0) {
        onChange([...teammates, ...toAdd]);
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
        {teammates.map((name) => (
          <span
            key={name}
            className="flex items-center gap-1 bg-gray-600 text-gray-200 text-sm px-2 py-0.5 rounded"
          >
            {name}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeTeammate(name); }}
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
          placeholder={teammates.length === 0 ? (placeholder || 'Tag a teammate...') : ''}
          className="flex-1 min-w-[120px] bg-transparent text-white placeholder-gray-500 text-sm outline-none py-0.5"
        />
      </div>

      {showDropdown && inputValue && filteredSuggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-gray-700 border border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {filteredSuggestions.map((suggestion, i) => (
            <button
              key={suggestion}
              type="button"
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                i === highlightIndex
                  ? 'bg-cyan-600 text-white'
                  : 'text-gray-300 hover:bg-gray-600'
              }`}
              onMouseDown={(e) => { e.preventDefault(); addTeammate(suggestion); }}
              onMouseEnter={() => setHighlightIndex(i)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
