'use strict';

var Github = require('github-api');

/**
 * Create a release from a given tag (in the options)
 *
 * @param  {GithubReleaseNotes} gren The gren object
 * @param  {Object} releaseOptions The options to build the release:
 * {
 *   "tag_name": "v1.0.0",
 *   "target_commitish": "master",
 *   "name": "v1.0.0",
 *   "body": "Description of the release",
 *   "draft": false,
 *   "prerelease": false
 * }
 */
function makeRelease(gren, releaseOptions) {
   return new Promise(function (resolve, reject) {
      gren.repo.makeRelease(releaseOptions, function (err, release) {
         if(err) {
            var responseText = JSON.parse(err.request.responseText);
            console.error(
               responseText.message + '\n'
               + responseText.errors[0].code
            );
            reject(false);
         } else {
            console.log(release.tag_name + ' successfully created!');
            resolve(true);
         }
      });
   });
}

/**
 * Return a string with a - to be a bullet list (used for a mapping)
 *
 * @param  {string} message
 *
 * @return {string}
 */
function createBody(message) {
   return '- ' + message;
}

/**
 * Transforms the commits to commit messages
 *
 * @param  {Object[]} commits The array of object containing the commits
 *
 * @return {String[]}
 */
function commitMessages(commits) {
   return commits.map(function (commitObject) {
      return commitObject.commit.message;
   });
}

/**
 * Creates the options to make the release
 *
 * @param  {GithubReleaseNotes} gren The gren object
 * @param  {Object[]} tags The collection of tags
 * @param  {string[]} commitMessages The commit messages to create the release body
 */
function prepareRelease(gren, tagName, commitMessages) {
   var body = commitMessages
      .slice(0, -1)
      .filter(function (message) {
         return !message.match(/^merge/i);
      })
      .map(createBody)
      .join('\n');

   var releaseOptions = {
      tag_name: tagName,
      name: (gren.options.prefix || '') + tagName,
      body: body,
      draft: gren.options.draft || false,
      prerelease: gren.options.prerelease || false
   };

   return makeRelease(gren, releaseOptions);
}

/**
 * Gets all the commits between two dates
 *
 * @param  {GithubReleaseNotes} gren The gren object
 * @param  {string} since The since date in ISO
 * @param  {string} until The until date in ISO
 *
 * @return {Promise}      The promise which resolves the [Array] commit messages
 */
function getCommitsBetweenTwo(gren, since, until) {
   var options = {
      since: since,
      until: until
   };

   return new Promise(function (resolve, reject) {
      gren.repo.getCommits(options, function (err, commits) {
         if(err) {
            reject(err);
         } else {
            resolve(commitMessages(commits));
         }
      });
   });
}

/**
 * Get the dates of the last two tags
 *
 * @param  {GithubReleaseNotes} gren The gren object
 * @param  {Object[]} tags List of all the tags in the repo
 *
 * @return {Promise[]}     The promises which returns the dates
 */
function getTagDates(gren, lastTag, lastRelease) {
   return [lastTag, lastRelease].map(function (tag) {
      return new Promise(function (resolve, reject) {
         gren.repo.getCommit('master', tag.commit.sha, function (err, commit) {
            if(err) {
               reject(err);
            } else {
               resolve(commit.committer.date);
            }
         });
      });
   })
}

/**
 * Get all the tags of the repo
 *
 * @param  {GithubReleaseNotes} gren The gren object
 *
 * @return {Promise}
 */
function getLastTags(gren, releaseTagName) {
   return new Promise(function (resolve, reject) {
      gren.repo.listTags(function (err, tags) {
         if(err) {
            reject(err);
         } else {
            var filteredTags = tags.filter(function(tag, index) {
               return index === 0 || (releaseTagName ? tag.name === releaseTagName : index === tags.length-1   );
            });

            resolve(filteredTags);
         }
      });
   });
}

/**
 * Get the latest release
 *
 * @param  {GithubReleaseNotes} gren The gren object
 *
 * @return {Promise} The promise which resolves the tag name of the release
 */
function getLatestRelease(gren) {
   return new Promise(function (resolve, reject) {
      gren.repo.getLatestRelease(function (err, release) {
         if(err && err.request.status !== 404) {
            reject(err);
         } else {
            if(err && err.request.status === 404) {
               resolve(false);
            } else {
               resolve(release.tag_name);
            }
         }
      });
   });
}

/**
 * Create a literal object of the node module options
 *
 * @param  {Array} args The array of arguments (the module arguments start from index 2)
 *
 * @return {Object}     The object containg the key/value options
 */
function getOptions(args) {
   var settings = {};

   for(var i=2;i<args.length;i++) {
      var paramArray = args[i].split('=');

      settings[paramArray[0].replace('--', '')] = paramArray[1];
   }

   return settings;
}

/**
 * @param  {Object} [options] The options of the module
 *
 * @constructor
 */
function GithubReleaseNotes(options) {
   this.options = options || getOptions(process.argv);
   this.options.force = this.options.force || false;

   var github = new Github({
     token: this.options.token,
     auth: 'oauth'
   });

   this.repo = github.getRepo(this.options.username, this.options.repo);
}

/**
 * Get All the tags, get the dates, get the commits between those dates and prepeare the release
 */
GithubReleaseNotes.prototype.release = function() {
   var that = this;
   var tagName;

   return getLatestRelease(this)
      .then(function (releaseTagName) {
         return getLastTags(that, releaseTagName);
      })
      .then(function (tags) {
         if(tags.length === 1) {
            throw new Error('The latest tag is the latest release!');
         }

         tagName = tags[0].name;

         return Promise.all(getTagDates(that, tags[0], tags[1]));
      })
      .then(function (data) {
         return getCommitsBetweenTwo(that, data[1], data[0]);
      })
      .then(function (commitMessages) {
         return prepareRelease(that, tagName, commitMessages);
      })
      .then(function (success) {
         return success;
      })
      .catch(function (error) {
         console.error(error);

         return that.options.force;
      });
};

module.exports = GithubReleaseNotes;