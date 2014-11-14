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
var dependencyLookup = {};
var types = [];
var enums = [];

// reduce all of the groups into a hashmap and a name array for easy lookup
var groups = libgit2.groups.reduce(function(memo, group) {
  group[1].typeName = group[0];
  memo[group[0]] = group[1];
  return memo;
}, {});


// Split each type from the array into classes/structs and enums
// each entry is of type ['name', {definingobject}]
libgit2.types.forEach(function(current) {
  current[1].typeName = current[0];

  // just log these out to a file for fun
  if (current[1].type === "enum") {
    enums.push(current[1]);
  }
  else {
    types.push(current[1]);
  }
});

var previous = "";
enums = _(enums).sortBy("name").reduce(function(enumMemo, enumerable) {
  if (previous == enumerable.typeName) {
    console.log('WARNING: duplicate definition for enum ' + enumerable.typeName +
      ". skipped.");
  }
  else if (!enumerable.fields) {
    console.log('WARNING: incomplete definition for enum ' + enumerable.typeName +
      ". skipped.");
  }
  else {
    enumMemo[enumerable.typeName] = {
      name: enumerable.typeName.replace(/^git_/, "").replace(/_t$/, ""),
      cType: enumerable.typeName,
      isMask: (/_t$/).test(enumerable.typeName),
      values: enumerable.fields.map(function(field) {
        return {
          name: field.name,
          value: field.value
        }
      })
    };
  }

  previous = enumerable.typeName;
  return enumMemo;
}, []).valueOf();

// decorate the definitions with required data to build the C++ files
types.forEach(function(typeDef) {
  var typeName = typeDef.typeName;
  typeDef.cType = typeName;
  typeName = typeName.replace("git_", "");
  typeDef.typeName = typeName;
  dependencyLookup[typeName] = typeName;

  typeDef.isClass = !!groups[typeName];
  typeDef.isStruct = !typeDef.isClass;

  typeDef.functions = groups[typeName] || [];
  utils.decoratePrimaryType(typeDef, enums);

  groups[typeName] = false;

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

  groupDef.isClass = true;
  groupDef.isStruct = false;

  groupDef.typeName = groupName;
  dependencyLookup[groupName] = groupName;
  utils.decoratePrimaryType(groupDef, enums);

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
    if (enumerable.typeName.indexOf(obj.typeName) == 0) {
        enumerable.owner = obj.jsClassName;
    }
    else if (enumerable.owner) {
      return true;
    }
  });

  var override = descriptor.enums[enumerable.typeName] || {};

  enumerable.owner = enumerable.owner || "Enums";

  enumerable.JsName = enumerable.typeName
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

fs.writeFileSync(path.join(__dirname, "output.json"),
  JSON.stringify(output, null, 2));

output = {types: output, enums: enums};

fs.writeFileSync(path.join(__dirname, "idefs.json"),
  JSON.stringify(output, null, 2));

fs.writeFileSync(path.join(__dirname, "enums.json"),
  JSON.stringify(enums, null, 2));
