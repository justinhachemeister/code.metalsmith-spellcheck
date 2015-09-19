require('harmonize')(['harmony-generators']);

var metalsmith = require('metalsmith'),
    fs = require('fs'),
    path = require('path'),
    _ = require('underscore'),
    chai = require('chai'),
    jsonfile = require('jsonfile'),
    async = require('async'),
    spellcheck = require('..'),
    spellcheckDefaults = require('../lib/spellcheckDefaults.js');

chai.use(require('chai-fs'));
var assert = chai.assert;

function reset_files(test_defaults) {
  try {
    fs.unlinkSync(test_defaults.failFile);
  } catch (err) {};
  try {
    fs.unlinkSync(test_defaults.exceptionFile);
  } catch (err) {};
  assert.notPathExists(test_defaults.exceptionFile);
  assert.notPathExists(test_defaults.failFile);
}

function check_files(files, defaults) {
  assert(!(defaults.failFile in files));
  assert(!(defaults.exceptionFile in files));
}

function defaultsWithDictionary() {
  var defaults = _.clone(spellcheckDefaults.defaults);
  defaults.dicFile = 'en_US.dic';
  defaults.affFile = 'en_US.aff';
  defaults.verbose = false;
  return defaults;
}

describe('metalsmith-spellcheck', function() {
  it('should identify misspelled words with the default parameters', function(done) {
    var src = 'test/fixtures/errors';
    var defaults = defaultsWithDictionary();
    var test_defaults = spellcheckDefaults.processConfig(defaults, path.join(src, 'src'));
    reset_files(test_defaults);

    metalsmith(src)
      .use(spellcheck(defaults))
      .build(function (err, files) {
        if (!err) {
          return done(new Error('should fail'));
        }
        assert.pathExists(test_defaults.failFile);
        var failures = jsonfile.readFileSync(test_defaults.failFile);
        assert.deepEqual(_.keys(failures).sort(), ["Challen", "smartphone", "wrd"].sort());
        done();
      });
  });
  it('should ignore misspelled words in the exception file', function(done) {
    var src = 'test/fixtures/errors';
    var defaults = defaultsWithDictionary();
    var test_defaults = spellcheckDefaults.processConfig(defaults, path.join(src, 'src'));
    var exceptions = { "smartphone": ['working.html'], "/^challen$/i": true };
    reset_files(test_defaults);
    jsonfile.writeFileSync(test_defaults.exceptionFile, exceptions);

    metalsmith(src)
      .use(spellcheck(defaults))
      .build(function (err, files) {
        if (!err) {
          return done(new Error('should fail'));
        }
        assert.pathExists(test_defaults.failFile);
        var failures = jsonfile.readFileSync(test_defaults.failFile);
        assert.deepEqual(_.keys(failures).sort(), ["wrd"].sort());
        done();
      });
  });
  it('should not fail when told not to', function(done) {
    var src = 'test/fixtures/errors';
    var defaults = defaultsWithDictionary();
    defaults.failErrors = false;
    var test_defaults = spellcheckDefaults.processConfig(defaults, path.join(src, 'src'));
    reset_files(test_defaults);

    metalsmith(src)
      .use(spellcheck(defaults))
      .build(function (err, files) {
        if (err) {
          return done(err);
        }
        assert.pathExists(test_defaults.failFile);
        var failures = jsonfile.readFileSync(test_defaults.failFile);
        assert.deepEqual(_.keys(failures).sort(), ["Challen", "smartphone", "wrd"].sort());
        done();
      });
  });
  it('should ignore misspelled words in metadata exceptions phrases', function(done) {
    var src = 'test/fixtures/errors';
    var defaults = defaultsWithDictionary();
    var test_defaults = spellcheckDefaults.processConfig(defaults, path.join(src, 'src'));
    reset_files(test_defaults);

    metalsmith(src)
      .use(function (files, metalsmith, done) {
        var metadata = metalsmith.metadata();
        metadata['spellcheck'] = {
          'phrases': ["Challen: smartphone"]
        };
        done();
      })
      .use(spellcheck(defaults))
      .build(function (err, files) {
        if (!err) {
          return done(new Error('should fail'));
        }
        assert.pathExists(test_defaults.failFile);
        var failures = jsonfile.readFileSync(test_defaults.failFile);
        assert.deepEqual(_.keys(failures).sort(), ["wrd"].sort());
        done();
      });
  });
  it('should ignore misspelled words in config exception phrases', function(done) {
    var src = 'test/fixtures/errors';
    var defaults = defaultsWithDictionary();
    defaults.exceptionPhrases = ["Challen: smartphone"];
    var test_defaults = spellcheckDefaults.processConfig(defaults, path.join(src, 'src'));
    reset_files(test_defaults);

    metalsmith(src)
      .use(spellcheck(defaults))
      .build(function (err, files) {
        if (!err) {
          return done(new Error('should fail'));
        }
        assert.pathExists(test_defaults.failFile);
        var failures = jsonfile.readFileSync(test_defaults.failFile);
        assert.deepEqual(_.keys(failures).sort(), ["wrd"].sort());
        done();
      });
  });
  it('should ignore misspelled words in metadata exception patterns', function(done) {
    var src = 'test/fixtures/errors';
    var defaults = defaultsWithDictionary();
    var test_defaults = spellcheckDefaults.processConfig(defaults, path.join(src, 'src'));
    reset_files(test_defaults);

    metalsmith(src)
      .use(function (files, metalsmith, done) {
        var metadata = metalsmith.metadata();
        metadata['spellcheck'] = {
          'patterns': ['/challen/i', '/smartphones?/'],
        };
        done();
      })
      .use(spellcheck(defaults))
      .build(function (err, files) {
        if (!err) {
          return done(new Error('should fail'));
        }
        assert.pathExists(test_defaults.failFile);
        var failures = jsonfile.readFileSync(test_defaults.failFile);
        assert.deepEqual(_.keys(failures).sort(), ["wrd"].sort());
        done();
      });
  });
  it('should ignore misspelled words in config exception patterns', function(done) {
    var src = 'test/fixtures/errors';
    var defaults = defaultsWithDictionary();
    defaults.exceptionPatterns = ['Challen', '/Smartphone/i'];
    var test_defaults = spellcheckDefaults.processConfig(defaults, path.join(src, 'src'));
    reset_files(test_defaults);

    metalsmith(src)
      .use(spellcheck(defaults))
      .build(function (err, files) {
        if (!err) {
          return done(new Error('should fail'));
        }
        assert.pathExists(test_defaults.failFile);
        var failures = jsonfile.readFileSync(test_defaults.failFile);
        assert.deepEqual(_.keys(failures).sort(), ["wrd"].sort());
        done();
      });
  });
});
