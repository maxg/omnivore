'use strict';

const util = require('util');

const should = require('should');

const omnivore = require('../src/omnivore');

describe('Omnivore', function() {
  
  let now = new Date();
  
  describe('types', () => {
    
    new Map([
      [ 'value', [
        [ false, true ],
        [ 0, true ],
        [ NaN, true ],
        [ Infinity, true ],
        [ '', true ],
        [ null, false ],
        [ undefined, false ],
        [ [ 1, '2' ], true ],
        [ [ () => {} ], false ],
        [ { 1: '2', 'three': [ 'four' ], '5': { } }, true ],
        [ { x: null }, false ],
        [ { y: new Date(0) }, false ],
        [ { z: { a: /b/ } }, false ],
      ] ],
      [ 'course', [
        [ '6.005/fa15', true ],
        [ 'SIX.DOUBLEOHFIVE/fa15', true ],
        [ '6.S04/fa15', true ],
        [ '6.s04/fa15', false ],
      ] ],
      [ 'key_path', [
        [ '', false ],
        [ '/', true ],
        [ '/a', true ],
        [ '/a/', false ],
        [ '/a/b', true ],
        [ '/*/b', false ],
        [ '/a/*', false ],
        [ 'a/b', false ],
        [ '/a/!b', false ],
        [ '/a/b|c', false ],
        [ '/a/b%', false ],
      ] ],
      [ 'key_path_query', [
        [ '', true ],
        [ '/', true ],
        [ '/a', true ],
        [ '/a/', false ],
        [ '/a/b', true ],
        [ '/*/b', true ],
        [ '/a/*', true ],
        [ 'a/b', true ],
        [ '*/b', true ],
        [ 'a/*', true ],
        [ 'a/!b', true ],
        [ 'a/b!', false ],
        [ 'a/b|c', true ],
        [ 'a/|b|c', false ],
        [ 'a/b|c|', false ],
        [ 'a/b%', true ],
        [ 'a/%b', false ],
      ] ],
      [ 'key_ltree_query', [
        [ '', true ],
        [ '.', false ],
        [ 'a', true ],
        [ 'a.', false ],
        [ 'a.b', true ],
        [ '*.b', false ],
        [ '*{1}.b', true ],
        [ 'b.*{1}', true ],
        [ 'a.!b', true ],
        [ 'a.b!', false ],
        [ 'a.b|c', true ],
        [ 'a.|b|c', false ],
        [ 'a.b|c|', false ],
        [ 'a.b%', true ],
        [ 'a.%b', false ],
      ] ],
    ]).forEach((pairs, type) => {
      describe(type, () => {
        new Map(pairs).forEach((expected, value) => {
          it(`${util.inspect(value)} ${expected ? 'is' : 'is not'} ${type}`, () => {
            omnivore.types.which(value, [ type ]).should.equal(expected ? type : 'none');
            omnivore.types.is(value, type).should.equal(expected);
            if (expected) {
              omnivore.types.assert(value, type).should.eql(value);
            } else {
              (function() { omnivore.types.assert(value, type); }).should.throw();
            }
          });
        });
      });
    });
    
    describe('#common()', () => {
      
      it('should return empty for no keys', () => {
        omnivore.types.common([]).should.eql('');
      });
      it('should return single key', () => {
        omnivore.types.common([ '/a/b/c' ]).should.eql('/a/b/c');
      });
      it('should find empty common prefix', () => {
        omnivore.types.common([ '/a/b/c', '/b/c' ]).should.eql('');
      });
      it('should find one-element common prefix', () => {
        omnivore.types.common([ '/a/b/c', '/a/c/d' ]).should.eql('/a');
      });
      it('should find multi-element common prefix', () => {
        omnivore.types.common([ '/a/b/c', '/a/b/d' ]).should.eql('/a/b');
      });
    });
    
    describe('#dateTimeString()', () => {
      it('should format date', () => {
        omnivore.types.dateTimeString(new Date(2017, 0, 1, 13)).should.eql('Sun Jan 1 1:00p');
      });
    });
  });
});
