'use strict';

const util = require('util');

const should = require('should');

const omnivore = require('../src/omnivore');

describe('Omnivore', function() {
  
  let now = new Date();
  
  describe('csv', () => {
    
    describe('#stringify()', () => {
      
      it('should export header row', done => {
        let sheet = omnivore.csv.stringify([ '/a', '/b' ], [ ], [ 'my comment' ]);
        sheet.setEncoding('utf-8');
        sheet.read().should.eql('"username","/a","/b","my comment"\n');
        done();
      });
      it('should export values', done => {
        let sheet = omnivore.csv.stringify([ '/a', '/b' ], [
          { username: 'alice', '/a': { value: 5 }, '/b': { value: '\'hello\'\n"there"' } },
        ]);
        sheet.setEncoding('utf-8');
        sheet.read().should.eql('"username","/a","/b"\n"alice",5,"\'hello\'\n""there"""\n');
        done();
      });
    });
    
    describe('#parse()', () => {
      
      new Map([
        [ 'boolean',
          [ [ `true`, true ], [ `"true"`, true ] ] ],
        [ 'number',
          [ [ `5`, 5 ], [ `"5"`, 5 ], [ `-5.1`, -5.1 ] ] ],
        [ 'string',
          [ [ `a`, 'a' ], [ `"'hello'\n""there"""`, `'hello'\n"there"` ], [ `" "`, ' ' ],
            [ `"hello\r\nthere\r\n"`, `hello\nthere\n`],
            [ `null`, 'null' ], [ `undefined`, 'undefined' ] ] ],
        [ 'undefined',
          [ [ ``, undefined ], [ `""`, undefined ], [ `   `, undefined ] ] ],
      ]).forEach((pairs, type) => {
        describe(type, () => {
          new Map(pairs).forEach((expected, value) => {
            it(`should parse value ${util.inspect(value)}`, done => {
              let sheet = omnivore.csv.parse(`username,/middle,/end
                                              alice,${value},${value}`);
              sheet.once('parsed', (keys, ts, rows) => {
                rows.should.read([ { values: [ expected, expected ] } ]);
                done();
              });
            });
          });
        });
      });
      
      it('should parse users and keys', done => {
        let sheet = omnivore.csv.parse(`username,/a,/b
                                        alice
                                        bob,1,2`);
        sheet.once('parsed', (keys, ts, rows) => {
          keys.should.eql([ '/a', '/b' ]);
          rows.should.read([ { username: 'alice' }, { username: 'bob' } ]);
          done();
        });
      });
      
      it('should parse timestamp', done => {
        let sheet = omnivore.csv.parse(`username,/a,/b,2020-02-02T02:22:20Z
                                        alice,3,4`);
        sheet.once('parsed', (keys, ts, rows) => {
          ts.should.eql(new Date('2020-02-02T02:22:20Z'));
          done();
        });
      });
      
      it('should ignore past invalid key', done => {
        let sheet = omnivore.csv.parse(`username,/a,/b-c,/d/e/f,x,/g,/h,2020-02-02T02:22:20Z
                                        alice,1,2,3,4,5,6`);
        sheet.once('parsed', (keys, ts, rows) => {
          keys.should.eql([ '/a', '/b-c', '/d/e/f' ]);
          should.not.exist(ts);
          rows.should.read([ { username: 'alice', values: [ 1, 2, 3 ] } ]);
          done();
        });
      });
      
      it('should ignore extra values', done => {
        let sheet = omnivore.csv.parse(`username,/a,/b
                                        alice,1.1,2.2,3.3`);
        sheet.once('parsed', (keys, ts, rows) => {
          keys.should.eql([ '/a', '/b' ]);
          rows.should.read([ { username: 'alice', values: [ 1.1, 2.2 ] } ]);
          done();
        });
      });
      
      it('should fill in missing values', done => {
        let sheet = omnivore.csv.parse(`username,/a,/b
                                        alice,apple`);
        sheet.once('parsed', (keys, ts, rows) => {
          keys.should.eql([ '/a', '/b' ]);
          rows.should.read([ { username: 'alice', values: [ 'apple', undefined ] } ]);
          done();
        });
      });
      
      it('should include invalid users', done => {
        let sheet = omnivore.csv.parse(`username,/a
                                        alice@mit,1
                                        bob,2`);
        sheet.once('parsed', (keys, ts, rows) => {
          keys.should.eql([ '/a' ]);
          rows.should.read([
            { username: 'alice@mit', values: [ 1 ] },
            { username: 'bob', values: [ 2 ] },
          ]);
          done();
        });
      });
    });
  });
});
