var debug = require('debug')('metalsmith-spellcheck'),
    path = require('path'),
    fs = require('fs'),
    async = require('async'),
    _ = require('underscore'),
		spellchecker = require('hunspell-spellchecker'),
    validate = require('validate.js'),
    validator = require('validator'),
    cheerio = require('cheerio'),
    jsonfile = require('jsonfile'),
    minimatch = require('minimatch'),
    MD5 = require('md5'),
    object_hash = require('object-hash'),
    yamljs = require('yamljs');
jsonfile.spaces = 4;

var defaults = {
  'verbose': true,
  'veryVerbose': false,
  'failErrors': true,
  'cacheChecks': true,
  'checkedPart': "*",
  'exceptionFile': 'spelling_exceptions.json',
  'checkFile': '.spelling_checked.json',
  'failFile': 'spelling_failed.json',
  'exceptions': [],
}

function processConfig(config, src) {
  config = config || {};
  config = _.extend(_.clone(defaults), config);
  if (src) {
    config.exceptionFile = path.join(src, config.exceptionFile);
    config.failFile = path.join(src, config.failFile);
    config.checkFile = path.join(src, config.checkFile);
  }
  return config;
}

function removeFiles(files, config) {
  if (files[config.checkFile]) {
    delete(files[config.checkFile]);
  }
  if (files[config.failFile]) {
    delete(files[config.failFile]);
  }
  if (files[config.exceptionFile]) {
    delete(files[config.exceptionFile]);
  }
  if (files[config.affFile]) {
    delete(files[config.affFile]);
  }
  if (files[config.dicFile]) {
    delete(files[config.dicFile]);
  }
};

function cleanText(text) {
  var words = text.trim()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\.\.\./g, ".")
    .replace(/[^a-zA-Z0-9'\.@]+/g, " ").trim().split(/\s+/);

  words = _.map(words, function (word) {
    if (((word.match(/\./g) || []).length == 1 && /^.*\.$/.test(word)) ||
        (/^.*:$/.test(word))) {
      word = word.substring(0, word.length - 1);
    }
    if (/^.*'$/.test(word)) {
      return word.substring(0, word.length - 1);
    } else if (/^.*'s/.test(word)) {
      return word.substring(0, word.length - 2);
    } else {
      return word;
    }
  });
  words = _.reject(words, function (word) {
    return (word === "") ||
      (word === "'s") ||
      /^\d{2}:\d{2}/.test(word) ||
      validate.isNumber(word) ||
      validator.isEmail(word) ||
      validator.isURL(word) ||
      validate.isDate(word);
  });
  return _.toArray(words);
};

var regexPattern = /^\/(.*?)\/([gim]*)$/;
var startBoundary = "(?:^|[^a-zA-Z0-9'@])";
var endBoundary = "(?=$|[^a-zA-Z0-9'\.@])";

function exceptionToPatterns(pattern, files) {
  var parts = pattern.match(regexPattern);
  if (parts) {
    var newPattern = parts[1];
    var flags = parts[2];
    if (flags.indexOf("g") === -1) {
      flags += "g";
    }
    return [{'files': files, 'pattern': new RegExp(startBoundary + newPattern + endBoundary, flags)}];
  } else {
    return _.map(cleanText(pattern), function (word) {
			if (word.length == 0) {
				return;
			}
			if (word[0].toUpperCase() != word[0]) {
				word = "(?:" + word[0].toUpperCase() + "|" + word[0] + ")" + word.substring(1, word.length);
			}
      return {'files': files, 'pattern': new RegExp(startBoundary + word + endBoundary, "g") }
    });
  }
}

function cleanup($, file) {
	$(".spelling_exception").each(function() {
		$(this).removeClass('spelling_exception');
		if ($(this).attr('class').trim() == "") {
			$(this).removeAttr('class');
		}
	});
	file.contents = new Buffer($.html());
}

function spellcheck(config) {

  return function(files, metalsmith, done) {

    config = processConfig(config);

    var realDone = function(err) {
      removeFiles(files, config);
      done(err)
    };

    if (!config.dict && (!(config.dicFile) || !(config.affFile))) {
      realDone(new Error("must provide either a dict or dicFile and affFile options to metalsmith-spellcheck"));
      return;
    }

    var dict, exceptions;
    try {
			if (config.dict) {
				dict = config.dict;
			} else {
				dict = new spellchecker();
				dict.use(dict.parse({
					aff: files[config.affFile].contents,
					dic: files[config.dicFile].contents
				}));
			}
      if (config.exceptionFile && files[config.exceptionFile]) {
        try {
          exceptions = JSON.parse(files[config.exceptionFile].contents);
        } catch (err) { };
        try {
          exceptions = yamljs.parse(files[config.exceptionFile].contents.toString());
        } catch (err) { };
        if (!exceptions) {
          throw new Error("can't parse exception file");
        }
      }
    } catch (err) {
      realDone(err);
      return;
    }

    if (config.cacheChecks) {
      var checked_files = { 'files': {}, 'exceptions': {}};
      try {
        checked_files = JSON.parse(files[config.checkFile].contents);
      } catch (err) {};
      var aff_hash = MD5(files[config.affFile].contents);
      var dic_hash = MD5(files[config.dicFile].contents);

      var can_cache = ((checked_files.files[config.affFile] == aff_hash) &&
          (checked_files.files[config.dicFile] == dic_hash));
      if (config.veryVerbose) {
        if (can_cache) {
          console.log("Using cached data for this spell check.");
        } else {
          console.log("No cached data for this spell check.");
        }
      }
      checked_files.files[config.affFile] = aff_hash;
      checked_files.files[config.dicFile] = dic_hash;
    }
    var examined_files = [];

    var metadata = metalsmith.metadata();
    var metadata_exceptions;
    try {
      metadata_exceptions = metadata['spelling_exceptions'];
    } catch (err) {};
    metadata_exceptions = _.union(config.exceptions, metadata_exceptions);

    var htmlfiles = _.pick(files, function(file, filename) {
      return (path.extname(filename) === '.html');
    });

    var filenamewords = {}, wordstofilenames = {}, uniqwords = [];
    var pattern_exceptions = {};

    _.each(htmlfiles, function (file, filename) {
      pattern_exceptions[filename] = [];
    });

    async.series([
        function (callback) {
          function addException(info) {
            if (info.files === true) {
              _.each(pattern_exceptions, function (patterns) {
                patterns.push(info.pattern);
              });
            } else {
              _.each(info.files, function (filepattern) {
                if (pattern_exceptions[filepattern]) {
                  pattern_exceptions[filepattern].push(info.pattern);
                }
                _.each(pattern_exceptions, function (patterns, filename) {
                  if (minimatch(filename, filepattern)) {
                    patterns.push(info.pattern);
                  }
                });
              });
            }
          };
          _.each(metadata_exceptions, function (exception) {
            _.map(exceptionToPatterns(exception, true), addException);
          });
          _.each(exceptions, function (info, exception) {
            _.map(exceptionToPatterns(exception, info), addException);
          });
          _.each(htmlfiles, function (file, filename) {
            if (file.spelling_exceptions) {
              _.each(file.spelling_exceptions, function (exception) {
                _.map(exceptionToPatterns(exception, [filename]), addException);
              });
            }
          });
          callback();
        },
        function (callback) {
          async.forEachOf(htmlfiles, function(file, filename, finished) {
            var $ = cheerio.load(file.contents);

            if (config.cacheChecks) {
              try {
                var file_hash = MD5($(config.checkedPart).html());
              } catch (err) {
								cleanup($, file);
                finished();
                return;
              }
              var exception_hash = object_hash(pattern_exceptions[filename].sort());

              if (can_cache &&
                  (checked_files.files[filename] == file_hash) &&
                  (checked_files.exceptions[filename] == exception_hash)) {
                if (config.veryVerbose) {
                  console.log(filename + " and its exceptions are unchanged. Not rechecking.");
                }
								cleanup($, file);
                finished();
                return;
              }
            }
            if (config.veryVerbose) {
              console.log(filename + " or its exceptions have changed. Rechecking.");
            }
            examined_files.push(filename);
            var allwords = [];
            $(config.checkedPart).find('*').contents().filter(function (index, element) {
              return (element.type === 'text' &&
                  $(element).parents('.spelling_exception').length == 0 &&
                  $(element).parents('script').length == 0 &&
                  $(element).parents('code').length == 0 &&
                  element.data.trim().length > 0);
            }).each(function (index, element) {
              var cleaned = cleanText(element.data).join(" ");
              _.each(pattern_exceptions[filename], function(pattern) {
                cleaned = cleaned.replace(pattern, " ");
              });
              allwords = _.union(allwords, cleaned.split(/\s+/));
            });
            if (config.cacheChecks) {
              checked_files.files[filename] = file_hash;
              checked_files.exceptions[filename] = exception_hash;
            }
            filenamewords[filename] = allwords;
						cleanup($, file);
            finished();
          },
          function() {
            _.each(filenamewords, function (allwords) {
              uniqwords = _.union(uniqwords, allwords);
            });
            _.each(uniqwords, function (word) {
              wordstofilenames[word] = [];
            });
            _.each(filenamewords, function (allwords, filename) {
              _.each(allwords, function (word) {
                wordstofilenames[word].push(filename);
              });
            });
            callback();
          });
        },
        function (callback) {
          async.filter(uniqwords, function (word, innerCallback) {
						innerCallback(null, !dict.check(word));
          }, function (err, results) {
            if (config.cacheChecks) {
              jsonfile.writeFileSync(path.join(metalsmith.source(), config.checkFile), checked_files);
            }
            var misspellings = {};
            try {
              misspellings = JSON.parse(files[config.failFile].contents);
            } catch (err) {};
            results = results.sort(function (a, b) {
              return a.toLowerCase().localeCompare(b.toLowerCase());
            });
            _.each(results, function (word) {
              if (misspellings[word]) {
                var bad_files = _.filter(misspellings[word], function (filename) {
                  return ((examined_files.indexOf(filename) === -1) ||
                          (wordstofilenames[word].indexOf(filename) !== -1));
                });
                if (bad_files.length == 0) {
                  delete(misspellings[word]);
                }
              } else {
                misspellings[word] = wordstofilenames[word];
              }
            });
            _.each(_.keys(misspellings), function (word) {
              if ((results.indexOf(word) === -1) &&
                  (_.intersection(examined_files, misspellings[word]).length == misspellings[word].length)) {
                delete(misspellings[word]);
              }
            });
            if (_.keys(misspellings).length == 0) {
              try {
                fs.unlinkSync(path.join(metalsmith.source(), config.failFile));
              } catch (err) {};
              realDone();
            } else {
              if (config.verbose) {
                console.log("There were spelling errors. See " + config.failFile);
              }
              jsonfile.writeFileSync(path.join(metalsmith.source(), config.failFile), misspellings);
              if (config.failErrors) {
                realDone(new Error("fail spelling check. See " + config.failFile));
              } else {
                realDone();
              }
            }
          });
        }
    ]);
  }
}
exports = module.exports = spellcheck;
exports.defaults = defaults;
exports.processConfig = processConfig;
