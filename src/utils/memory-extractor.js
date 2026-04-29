const config = require('../config-loader');

class MemoryExtractor {
  /**
   * Extract lightweight features from text content
   * @param {string} text - The content to analyze
   * @returns {object} Extracted features
   */
  static extractMemoryFeatures(text) {
    return {
      type: this.detectType(text),
      tags: this.extractTags(text),
      entities: this.extractEntities(text),
      summary: this.generateSummary(text),
      importance: this.calculateImportance(text),
      confidence: 0.8
    };
  }

  /**
   * Detect memory type based on keywords and patterns
   * @param {string} text
   * @returns {string} Type: "fact", "event", "preference", "task", "general"
   */
  static detectType(text) {
    const lowerText = text.toLowerCase();

    // Task indicators
    if (lowerText.match(/\b(todo|task|do|complete|finish|deadline|remind)\b/)) {
      return "task";
    }

    // Preference indicators
    if (lowerText.match(/\b(like|prefer|favorite|love|hate|dislike|want|need)\b/)) {
      return "preference";
    }

    // Event indicators (past/present tense)
    if (lowerText.match(/\b(happened|occurred|went|attended|met|visited|started|ended)\b/)) {
      return "event";
    }

    // Fact indicators
    if (lowerText.match(/\b(is|are|was|were|has|have|had|will|would|can|could|should|must)\b.*\./)) {
      return "fact";
    }

    return "general";
  }

  /**
   * Extract up to 5 relevant tags
   * @param {string} text
   * @returns {string[]} Array of tags
   */
  static extractTags(text) {
    const tags = [];
    const lowerText = text.toLowerCase();

    // Priority keywords
    const priorityTags = {
      urgent: /\b(urgent|emergency|critical|asap|immediate)\b/,
      important: /\b(important|priority|key|essential|vital)\b/,
      personal: /\b(personal|private|confidential)\b/,
      work: /\b(work|business|professional|meeting|project)\b/,
      learning: /\b(learn|study|research|course|tutorial)\b/
    };

    // Check for priority tags
    for (const [tag, regex] of Object.entries(priorityTags)) {
      if (regex.test(lowerText)) {
        tags.push(tag);
        if (tags.length >= 3) break; // Limit to prevent overflow
      }
    }

    // Add content-type tags
    if (lowerText.includes('code') || lowerText.includes('function') || lowerText.includes('script')) {
      tags.push('code');
    }
    if (lowerText.includes('error') || lowerText.includes('bug') || lowerText.includes('fix')) {
      tags.push('technical');
    }
    if (lowerText.match(/\b(question|ask|query|help)\b/)) {
      tags.push('question');
    }

    return tags.slice(0, 5); // Max 5 tags
  }

  /**
   * Extract up to 5 potential entities (people, places, organizations)
   * @param {string} text
   * @returns {string[]} Array of entities
   */
  static extractEntities(text) {
    const entities = [];

    // Simple pattern matching for common entities
    // People: Capitalized words that might be names
    const potentialPeople = text.match(/\b[A-Z][a-z]+\s[A-Z][a-z]+\b/g);
    if (potentialPeople) {
      entities.push(...potentialPeople.slice(0, 2));
    }

    // Places: Geographic indicators
    if (text.match(/\b(city|country|place|location|address)\b/i)) {
      const placeWords = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g);
      if (placeWords) {
        entities.push(...placeWords.slice(0, 2));
      }
    }

    // Organizations: Common company patterns
    const orgPatterns = [
      /\b(Google|Microsoft|Apple|Amazon|Facebook|Twitter)\b/gi,
      /\b(Inc|Corp|LLC|Ltd|Company)\b.*?\b[A-Z][a-z]+\b/gi
    ];

    for (const pattern of orgPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        entities.push(...matches.slice(0, 2));
        break;
      }
    }

    // Remove duplicates and limit
    return [...new Set(entities)].slice(0, 5);
  }

  /**
   * Generate a short 1-line summary
   * @param {string} text
   * @returns {string} Summary
   */
  static generateSummary(text) {
    // Take first sentence, or first 100 characters
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
    if (sentences.length > 0) {
      return sentences[0].trim().substring(0, 200);
    }

    // Fallback: first 100 characters
    return text.trim().substring(0, 100) + (text.length > 100 ? '...' : '');
  }

  /**
   * Calculate importance score (0-1)
   * @param {string} text
   * @returns {number} Importance score
   */
  static calculateImportance(text) {
    let score = 0.5; // Base score
    const lowerText = text.toLowerCase();

    // Importance indicators
    const importantWords = ['urgent', 'critical', 'important', 'priority', 'key', 'essential', 'vital', 'deadline'];
    const urgentWords = ['asap', 'emergency', 'immediately', 'now'];

    // Check for urgent words
    for (const word of urgentWords) {
      if (lowerText.includes(word)) {
        score += 0.3;
        break;
      }
    }

    // Check for important words
    for (const word of importantWords) {
      if (lowerText.includes(word)) {
        score += 0.2;
        break;
      }
    }

    // Length-based scoring (longer content might be more important)
    if (text.length > 500) score += 0.1;
    if (text.length > 1000) score += 0.1;

    // Question vs statement (questions might be less important)
    if (lowerText.includes('?')) score -= 0.1;

    return Math.max(0, Math.min(1, score));
  }
}

module.exports = MemoryExtractor;