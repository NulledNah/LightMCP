import { describe, it, expect, vi } from 'vitest';
import { detectNonEnglish } from '../../src/ollama/translator.js';

describe('translator.ts — detectNonEnglish', () => {
  it('should return false for plain English queries', () => {
    expect(detectNonEnglish('find all resistors in my schematic')).toBe(false);
    expect(detectNonEnglish('add a resistor to the circuit board')).toBe(false);
    expect(detectNonEnglish('list all component values for the design')).toBe(false);
  });

  it('should return false for short English queries', () => {
    expect(detectNonEnglish('hello world')).toBe(false);
    expect(detectNonEnglish('test')).toBe(false);
    expect(detectNonEnglish('a simple task')).toBe(false);
  });

  it('should return false for short English queries', () => {
    expect(detectNonEnglish('hello world')).toBe(false);
    expect(detectNonEnglish('test')).toBe(false);
    expect(detectNonEnglish('a simple task')).toBe(false);
  });

  it('should detect Italian queries', () => {
    expect(detectNonEnglish('come posso trovare un componente nel catalogo')).toBe(true);
    expect(detectNonEnglish('voglio fare una ricerca nel database')).toBe(true);
    expect(detectNonEnglish('cosa devo fare per creare un nuovo progetto')).toBe(true);
  });

  it('should detect Spanish queries', () => {
    expect(detectNonEnglish('cómo puedo buscar un componente en la librería')).toBe(true);
    expect(detectNonEnglish('quiero hacer un nuevo proyecto de PCB')).toBe(true);
    expect(detectNonEnglish('para qué sirve esta herramienta')).toBe(true);
  });

  it('should detect French queries', () => {
    expect(detectNonEnglish('comment puis-je trouver un composant dans la bibliothèque')).toBe(true);
    expect(detectNonEnglish('je veux créer un nouveau circuit imprimé')).toBe(true);
    expect(detectNonEnglish('pourquoi cet outil ne fonctionne pas')).toBe(true);
  });

  it('should detect German queries', () => {
    expect(detectNonEnglish('wie kann ich eine Komponente in der Bibliothek finden')).toBe(true);
    expect(detectNonEnglish('ich möchte ein neues PCB-Layout erstellen')).toBe(true);
    expect(detectNonEnglish('was muss ich tun um das Projekt zu speichern')).toBe(true);
  });

  it('should detect Portuguese queries', () => {
    expect(detectNonEnglish('como posso encontrar um componente na biblioteca')).toBe(true);
    expect(detectNonEnglish('eu quero fazer um novo projeto de PCB')).toBe(true);
    expect(detectNonEnglish('para que serve esta ferramenta')).toBe(true);
  });

  it('should return false for mixed English with few non-English words', () => {
    expect(detectNonEnglish('search for the schematic and open it')).toBe(false);
    expect(detectNonEnglish('get the footprint library from the server')).toBe(false);
  });

  it('should handle empty string', () => {
    expect(detectNonEnglish('')).toBe(false);
  });

  it('should handle very short queries', () => {
    expect(detectNonEnglish('PCB')).toBe(false);
    expect(detectNonEnglish('resistor value')).toBe(false);
  });

  it('should detect French words like qui, que, est', () => {
    expect(detectNonEnglish('qui est responsable de ce fichier')).toBe(true);
  });

  it('should detect German articles and prepositions', () => {
    expect(detectNonEnglish('der widerstand ist zu groß')).toBe(true);
  });

  it('should detect Portuguese function words', () => {
    expect(detectNonEnglish('não sei como fazer isso')).toBe(true);
  });
});
