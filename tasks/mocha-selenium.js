"use strict";

module.exports = function(grunt) {
  var createDomain = require('domain').create;
  var mocha = require("./lib/mocha-runner");
  var mochaReporterBase = require("mocha/lib/reporters/base");

  var seleniumLauncher = require("selenium-launcher");
  var wdSync = require("wd-sync");
  var wd = require("wd");
  var wdParallel = require("wd-parallel");
  var path = require("path");

  grunt.registerMultiTask("mochaSelenium", "Run functional tests with mocha", function() {
    var done = this.async();
    // Retrieve options from the grunt task.
    var options = this.options({
      browserName: 'firefox',
      usePromises: true,
      useSystemPhantom: false
    });

    // We want color in our output, but when grunt-contrib-watch is used,
    //  mocha will detect that it's being run to a pipe rather than tty.
    // Mocha provides no way to force the use of colors, so, again, hack it.
    var priorUseColors = mochaReporterBase.useColors;
    if (options.useColors) {
      mochaReporterBase.useColors = true;
    }

    // More agnostic -- just remove *all* the uncaughtException handlers;
    //  they're almost certainly going to exit the process, which,
    //  in this case, is definitely not what we want.
    // var uncaughtExceptionHandlers = process.listeners('uncaughtException');
    // process.removeAllListeners('uncaughtException');
    // var unmanageExceptions = function() {
    //   uncaughtExceptionHandlers.forEach(
    //     process.on.bind(process, 'uncaughtException'));
    // };
    // Better, deals with more than just grunt?

    // Restore prior state.
    var restore = function() {
      mochaReporterBase.useColors = priorUseColors;
      //unmanageExceptions();
      done();
    };

    grunt.util.async.forEachSeries(this.files, function(fileGroup, next){
      runTests(fileGroup, options, next);
    }, restore);
  });

  function runTests(fileGroup, orgOptions, next){
    var mochaDone = function(errCount) {
      var withoutErrors = (errCount === 0);
      // Indicate whether we failed to the grunt task runner
      next(withoutErrors);
    };

    var setupBrowser = function(browser, options, shutdown) {
      browser.on('status', function(info){
        grunt.log.writeln('\x1b[36m%s\x1b[0m', info);
      });

      browser.on('command', function(meth, path, data){
        grunt.log.debug(' > \x1b[33m%s\x1b[0m: %s', meth, path, data || '');
      });

      browser.init(options, function(err){
        if(err){
          grunt.fail.fatal(err);
          return;
        }
        var runner = mocha(orgOptions, browser, grunt, fileGroup);
        // Create the domain, and pass any errors to the mocha runner
        var domain = createDomain();
        domain.on('error', runner.uncaught.bind(runner));

        // Give selenium some breathing room
        setTimeout(function(){
          // Selenium Download and Launch
          domain.run(function() {
            runner.run(function(err) {
              browser.quit(function() {
                shutdown();
                mochaDone(err);
              });
            });
          });
        }, 300);
      });
    };

    var parallelBrowser = function() {
      var browsers = wdParallel.remote(
        "ondemand.saucelabs.com",
        80,
        "",
        ""
      );
      browsers.test = function(browser, desired) {
        setupBrowser(browser, desired, function(err) {
          mochaDone(err);
        })
      };
      browsers.run([
        {browserName: "firefox"},
        {browserName: "chrome"}
      ]);
    };

    var browserWithLauncher = function() {
      seleniumLauncher(function(err, selenium) {
        grunt.log.writeln('Selenium Running');
        if (err) {
          selenium.exit();
          grunt.fail.fatal(err);
          return;
        }

        var remote = orgOptions.usePromises ? 'promiseRemote' : 'remote';
        remote = orgOptions.useChaining ? 'promiseChainRemote' : remote;

        var browser = wd[remote](selenium.host, selenium.port);

        setupBrowser(browser, {
          browserName: "firefox"
        }, function(err) {
          selenium.kill();
        });
      });
    };
    browserWithLauncher();
  }
};
