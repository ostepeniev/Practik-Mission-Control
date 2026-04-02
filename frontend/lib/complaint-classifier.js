/**
 * Complaint AI Classification Module
 * 
 * Classifies complaints into categories using keyword matching.
 * When LLM is available, can be upgraded to use AI for more nuanced classification.
 * 
 * Categories:
 * - diet_mismatch: не підійшов раціон, алергія, відмова від їжі
 * - batch_problem: проблема партії, якість, зіпсований, плісняв
 * - shipping_damage: пошкодження при доставці, упаковка розірвана
 * - packaging_error: помилка комплектації, не той товар, кількість
 * - quality_concern: загальна якість, запах, консистенція
 * - other: не вдалося класифікувати
 */

const CLASSIFICATION_RULES = [
  {
    type: 'diet_mismatch',
    label: 'Не підійшов раціон',
    icon: '🐾',
    keywords: ['не підійшов', 'алергія', 'відмова', 'не їсть', 'не підходить', 'алергічна', 'діарея', 'розлад', 'блювота', 'свербіж'],
  },
  {
    type: 'batch_problem',
    label: 'Проблема партії',
    icon: '🏭',
    keywords: ['партія', 'зіпсований', 'плісняв', 'просрочений', 'прострочений', 'запах гнилі', 'цвіль', 'бактерії', 'відкликання'],
  },
  {
    type: 'shipping_damage',
    label: 'Пошкодження доставки',
    icon: '📦',
    keywords: ['пошкодж', 'розірван', 'розбит', 'протік', 'мокрий', 'зім\'ят', 'деформ', 'доставк'],
  },
  {
    type: 'packaging_error',
    label: 'Помилка комплектації',
    icon: '📋',
    keywords: ['не той товар', 'не та кількість', 'комплектац', 'замість', 'помилк', 'недовкладка', 'перевкладка', 'пересортиця'],
  },
  {
    type: 'quality_concern',
    label: 'Якість продукту',
    icon: '⚠️',
    keywords: ['якість', 'консистенц', 'запах', 'колір', 'текстура', 'смак', 'вигляд', 'неприємн', 'дивний'],
  },
];

/**
 * Classify a complaint description using keyword matching
 * @param {string} description - complaint text
 * @returns {{ type: string, label: string, icon: string, confidence: number }}
 */
export function classifyComplaint(description) {
  if (!description) return { type: 'other', label: 'Інше', icon: '❓', confidence: 0 };
  
  const text = description.toLowerCase();
  
  let bestMatch = null;
  let bestScore = 0;
  
  for (const rule of CLASSIFICATION_RULES) {
    let matchCount = 0;
    for (const keyword of rule.keywords) {
      if (text.includes(keyword.toLowerCase())) matchCount++;
    }
    
    if (matchCount > bestScore) {
      bestScore = matchCount;
      bestMatch = rule;
    }
  }
  
  if (bestMatch && bestScore >= 1) {
    const confidence = Math.min(0.95, 0.5 + bestScore * 0.15);
    return {
      type: bestMatch.type,
      label: bestMatch.label,
      icon: bestMatch.icon,
      confidence: Math.round(confidence * 100) / 100,
    };
  }
  
  return { type: 'other', label: 'Інше', icon: '❓', confidence: 0.3 };
}

/**
 * Get all classification types for UI display
 */
export function getClassificationTypes() {
  return [
    ...CLASSIFICATION_RULES.map(r => ({ type: r.type, label: r.label, icon: r.icon })),
    { type: 'other', label: 'Інше', icon: '❓' },
  ];
}
