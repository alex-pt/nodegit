const fs = require("fs");
const path = require("path");
const utils = require("./utils");
const _ = require("lodash");

var version = require("../package.json").libgit2.version;
var descriptor = require("./descriptor.json");
var libgit2 = require("./v" + version + ".json");
var supplement = require("./libgit2-supplement.json");

libgit2.types.forEach(function(type) {
  if (supplement.types[type[0]]){
    _.merge(type[1], supplement.types[type[0]]);
  }
});

// libgit2's docs aren't complete so we'll add in what they're missing here
Array.prototype.push.apply(libgit2.types, supplement.new.types);

var output = [];
var groupNames = [];
var dependencyLookup = {};
var types = [];
var enums = [];

// reduce all of the groups into a hashmap and a name array for easy lookup
var groups = libgit2.groups.reduce(function(memo, group) {
  group[1].typeName = group[0];
  memo[group[0]] = group[1];
  groupNames.push(group[0]);
  return memo;
}, {});


// Process each type in the types array into classes and structs and
// decorate the definitions with required data to build the C++ files
libgit2.types.forEach(function(current) {
  var typeName = current[0];
  var typeDefOverrides = descriptor.types[typeName] || {};
  var typeDef = current[1];

  typeDef.typeName = typeName;

  // just log these out to a file for fun
  if (typeDef.type === "enum") {
    enums.push(typeDef);
  }
  else {
    types.push(typeDef);
  }
});

enums = _.sortBy(enums, "name");

var previous = "";
enums = enums.reduce(function(enumMemo, enumerable) {
  if (previous == enumerable.typeName) {
    console.log('WARNING: duplicate definition for enum ' + enumerable.name +
      ". skipped.");
  }
  else if (!enumerable.fields) {
    console.log('WARNING: incomplete definition for enum ' + enumerable.name +
      ". skipped.");
  }
  else {
    enumMemo.push({
      name: enumerable.typeName.replace(/^git_/, "").replace(/_t$/, ""),
      cType: enumerable.typeName,
      isMask: (/_t$/).test(enumerable.typeName),
      values: enumerable.fields.map(function(field) {
        return {
          name: field.name,
          value: field.value
        }
      })
    });
  }

  previous = enumerable.name;
  return enumMemo;
}, []);

types.forEach(function(typeDef) {
  var typeName = typeDef.typeName;
  typeDef.cType = typeName;
  typeName = typeName.replace("git_", "");
  typeDef.typeName = typeName;
  dependencyLookup[typeName] = typeName;

  typeDef.isClass = utils.isClass(typeName, groupNames);
  typeDef.isStruct = !typeDef.isClass;

  utils.decoratePrimaryType(typeDef);

  if (typeDef.isClass) {
    typeDef.functions = groups[typeName];
    utils.decorateClass(typeDef);
    groups[typeName] = false;
  }
  else {
    utils.decorateStruct(typeDef);
  }

  output.push(typeDef);
});

// Loop over the groups in case we missed anything (eg the types are missing in the docs);
for (var groupName in groups) {
  var groupDef = groups[groupName];
  if (groupDef === false) {
    continue;
  }

  groupDef = {
    functions: groupDef
  };

  var classDefOverrides = descriptor.types[groupName] || {};
  groupDef.isClass = true;
  groupDef.isStruct = false;

  groupDef.typeName = groupName;
  dependencyLookup[groupName] = groupName;
  utils.decoratePrimaryType(groupDef);
  utils.decorateClass(groupDef, classDefOverrides);

  output.push(groupDef);
}

// Calculate dependencies
output.forEach(function (def) {
  if (def.ignore) {
    return;
  }

  var dependencies = {};
  var addDependencies = function (prop) {
    if (prop.ignore) {
      return;
    }

    var type = utils.normalizeCtype(prop.type || prop.cType).replace("git_", "");
    var dependencyFilename = dependencyLookup[type];

    if (dependencyFilename) {
      dependencies[dependencyFilename] = dependencyFilename;
    }

    (prop.args || []).forEach(addDependencies);

    if (prop.return) {
      addDependencies(prop.return);
    }
  };

  def.fields.forEach(addDependencies);
  def.functions.forEach(addDependencies);

  Object.keys(dependencies).forEach(function (dependencyFilename) {
    def.dependencies.push("../include/" + dependencyFilename + ".h");
  });
});

// Process enums
enums.forEach(function(enumerable) {
  output.some(function(obj) {
    if (enumerable.name.indexOf(obj.typeName) == 0) {
        enumerable.owner = obj.jsClassName;
    }
    else if (enumerable.owner) {
      return true;
    }
  });

  var override = descriptor.enums[enumerable.name] || {};

  enumerable.owner = enumerable.owner || "Enums";

  enumerable.JsName = enumerable.name
    .replace(new RegExp("^" + enumerable.owner.toLowerCase()), "")
    .replace(/^_/, "")
    .toUpperCase();

  enumerable.values.forEach(function(value) {
    value.JsName = value.name
      .replace(/^GIT_/, "")
      .replace(new RegExp("^" + enumerable.owner.toUpperCase()), "")
      .replace(/^_/, "")
      .replace(new RegExp("^" + enumerable.JsName), "")
      .replace(/^_/, "")
      .toUpperCase();

    if (override.values && override.values[value.name]) {
      _.merge(value, override.values[value.name]);
    }
  });

  _.merge(enumerable, _.omit(override, ["values"]));
});

enums = _(enums).groupBy("owner").reduce(function(memo, collection, owner) {
  collection.forEach(function(enumerable) {
    delete enumerable.owner;
  });
  memo.push({owner: owner, enums: collection});
  return memo;
}, []).valueOf();

output = _.sortBy(output, "typeName");

if (process.argv[2] != "--documentation") {
  utils.filterDocumentation(output);
}

output = {types: output, enums: enums};

fs.writeFileSync(path.join(__dirname, "idefs.json"),
  JSON.stringify(output, null, 2));

fs.writeFileSync(path.join(__dirname, "enums.json"),
  JSON.stringify(enums, null, 2));
