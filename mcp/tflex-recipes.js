const REF_SCHEMA = {
  type: "object",
  additionalProperties: true,
  description: "Reference returned by another T-FLEX recipe tool, for example { kind, name, index, operationName, bodyIndex, faceIndex }."
};

export const recipeTools = [
  {
    name: "tflex_query_model",
    description: "Query the T-FLEX model: list objects, find objects, list operation faces, list mate targets, or list mates.",
    inputSchema: documentOptionsSchema({
      action: {
        type: "string",
        enum: ["list_objects", "find_object", "list_operation_faces", "list_mate_targets", "list_mates"],
        description: "Query action to run."
      },
      query: { type: "string", description: "Name substring to search for." },
      kind: { type: "string", enum: ["any", "operation", "profile", "lcs", "fragment", "mate"], default: "any" },
      operationName: { type: "string" },
      operationIndex: { type: "number" },
      includeEdges: { type: "boolean", default: false },
      includeFaces: { type: "boolean", default: true },
      maxFaces: { type: "number", default: 200 }
    }, ["action"])
  },
  {
    name: "tflex_create_lcs",
    description: "Create a local coordinate system by points or by transform.",
    inputSchema: documentOptionsSchema({
      mode: { type: "string", enum: ["points", "transform"] },
      name: { type: "string" },
      origin: pointSchema("Origin point [x, y, z]."),
      xPoint: pointSchema("Point defining X axis [x, y, z]."),
      yPoint: pointSchema("Point defining Y axis [x, y, z]."),
      rotation: pointSchema("Euler rotation [rx, ry, rz] in degrees."),
      axisLength: { type: "number", default: 100 },
      useForFragment: { type: "boolean", default: true }
    }, ["mode", "name", "origin"], true)
  },
  {
    name: "tflex_model_operation",
    description: "Run a model operation recipe: extrude profile, boolean operation, or rename last operation.",
    inputSchema: documentOptionsSchema({
      action: { type: "string", enum: ["extrude_profile", "boolean", "rename_last_operation"] },
      profileName: { type: "string" },
      profileIndex: { type: "number" },
      distance: { type: "number" },
      backwardDistance: { type: "number", default: 0 },
      saveOperandsVisible: { type: "boolean", default: false },
      type: { type: "string", enum: ["unite", "subtract", "intersect"] },
      firstOperands: { type: "array", items: REF_SCHEMA },
      secondOperands: { type: "array", items: REF_SCHEMA },
      operationName: { type: "string" },
      keepOperandsVisible: { type: "boolean", default: false },
      name: { type: "string", description: "New name for rename_last_operation." }
    }, ["action"], true)
  },
  {
    name: "tflex_fragment",
    description: "Insert a 3D fragment, optionally fixing one of its LCSs to an assembly LCS.",
    inputSchema: documentOptionsSchema({
      action: { type: "string", enum: ["insert", "insert_at_lcs"] },
      fragmentPath: { type: "string" },
      name: { type: "string" },
      sourceLcsName: { type: "string", description: "LCS name inside the inserted fragment." },
      targetLcsName: { type: "string", description: "LCS name in the assembly document." }
    }, ["action", "fragmentPath"], true)
  },
  {
    name: "tflex_mate",
    description: "Create, list, suppress, or unsuppress T-FLEX mates.",
    inputSchema: documentOptionsSchema({
      action: { type: "string", enum: ["create", "list", "suppress"] },
      type: {
        type: "string",
        description: "Mate type alias or exact T-FLEX enum name, for example coincident, distance, angle, concentric, parallel."
      },
      target1: REF_SCHEMA,
      target2: REF_SCHEMA,
      name: { type: "string" },
      distance: { type: "number" },
      angle: { type: "number" },
      reversedNormal: { type: "boolean", default: false },
      reversedDirection: { type: "boolean", default: false },
      mateName: { type: "string" },
      mateIndex: { type: "number" },
      suppressed: { type: "boolean" }
    }, ["action"], true)
  }
];

export function buildRecipeBridgeCall(name, args = {}) {
  const normalized = normalizeRecipeCall(name, args);
  const builders = {
    tflex_list_model_objects: listModelObjectsCode,
    tflex_find_object: findObjectCode,
    tflex_list_operation_faces: listOperationFacesCode,
    tflex_list_mate_targets: listMateTargetsCode,
    tflex_create_lcs_by_points: createLcsByPointsCode,
    tflex_create_lcs_by_transform: createLcsByTransformCode,
    tflex_extrude_profile: extrudeProfileCode,
    tflex_boolean: booleanCode,
    tflex_insert_fragment: insertFragmentCode,
    tflex_insert_fragment_at_lcs: insertFragmentAtLcsCode,
    tflex_create_mate: createMateCode,
    tflex_list_mates: listMatesCode,
    tflex_suppress_mate: suppressMateCode,
    tflex_rename_last_operation: renameLastOperationCode
  };

  const build = builders[normalized.name];
  if (!build) return null;

  return {
    command: "execute_csharp",
    args: {
      code: build(normalized.args),
      scriptArgs: normalized.args,
      documentPath: normalized.args.documentPath,
      save: Boolean(normalized.args.save),
      saveAsPath: normalized.args.saveAsPath,
      description: normalized.args.description || `Codex recipe: ${name}`
    }
  };
}

function normalizeRecipeCall(name, args) {
  const action = String(args.action || "").toLowerCase();
  const mode = String(args.mode || "").toLowerCase();

  if (name === "tflex_query_model") {
    const map = {
      list_objects: "tflex_list_model_objects",
      find_object: "tflex_find_object",
      list_operation_faces: "tflex_list_operation_faces",
      list_mate_targets: "tflex_list_mate_targets",
      list_mates: "tflex_list_mates"
    };
    return { name: map[action] || name, args };
  }

  if (name === "tflex_create_lcs") {
    const map = {
      points: "tflex_create_lcs_by_points",
      transform: "tflex_create_lcs_by_transform"
    };
    return { name: map[mode] || name, args };
  }

  if (name === "tflex_model_operation") {
    const map = {
      extrude_profile: "tflex_extrude_profile",
      boolean: "tflex_boolean",
      rename_last_operation: "tflex_rename_last_operation"
    };
    return { name: map[action] || name, args };
  }

  if (name === "tflex_fragment") {
    const map = {
      insert: "tflex_insert_fragment",
      insert_at_lcs: "tflex_insert_fragment_at_lcs"
    };
    return { name: map[action] || name, args };
  }

  if (name === "tflex_mate") {
    const map = {
      create: "tflex_create_mate",
      list: "tflex_list_mates",
      suppress: "tflex_suppress_mate"
    };
    return { name: map[action] || name, args };
  }

  return { name, args };
}

function documentOptionsSchema(properties, required = [], mutates = false) {
  return {
    type: "object",
    properties: {
      documentPath: {
        type: "string",
        description: "Optional document path to open before running this recipe."
      },
      save: {
        type: "boolean",
        default: false,
        description: "Save after successful execution."
      },
      saveAsPath: {
        type: "string",
        description: "Optional SaveAs path after successful execution."
      },
      description: {
        type: "string",
        description: "Optional T-FLEX BeginChanges description."
      },
      ...properties
    },
    required
  };
}

function pointSchema(description) {
  return {
    type: "array",
    items: { type: "number" },
    minItems: 3,
    maxItems: 3,
    description
  };
}

function commonReflectionCode() {
  return `
Func<object, string, object> Prop = (obj, propName) => {
    if (obj == null) return null;
    var p = obj.GetType().GetProperty(propName);
    if (p == null) return null;
    try { return p.GetValue(obj, null); } catch { return null; }
};
Action<object, string, object> SetProp = (obj, propName, value) => {
    if (obj == null) return;
    var p = obj.GetType().GetProperty(propName);
    if (p == null || !p.CanWrite) return;
    p.SetValue(obj, value, null);
};
Func<object, string, string> StrProp = (obj, propName) => {
    var value = Prop(obj, propName);
    return value == null ? null : Convert.ToString(value, CultureInfo.InvariantCulture);
};
Func<object, int> CountOf = (obj) => {
    if (obj == null) return 0;
    var length = Prop(obj, "Length");
    if (length != null) return Convert.ToInt32(length, CultureInfo.InvariantCulture);
    var count = Prop(obj, "Count");
    if (count != null) return Convert.ToInt32(count, CultureInfo.InvariantCulture);
    var enumerable = obj as IEnumerable;
    if (enumerable == null) return 0;
    int n = 0;
    foreach (object _ in enumerable) n++;
    return n;
};
Func<object, int, object> At = (obj, index) => {
    if (obj == null) return null;
    var pi = obj.GetType().GetProperty("Item", new Type[] { typeof(int) });
    if (pi != null) { try { return pi.GetValue(obj, new object[] { index }); } catch {} }
    var enumerable = obj as IEnumerable;
    if (enumerable == null) return null;
    int atLoopIndex = 0;
    foreach (object item in enumerable) {
        if (atLoopIndex == index) return item;
        atLoopIndex++;
    }
    return null;
};
Func<object, Dictionary<string, object>> BasicInfo = (obj) => {
    var item = new Dictionary<string, object>();
    if (obj == null) {
        item["type"] = null;
        return item;
    }
    item["type"] = obj.GetType().FullName;
    item["name"] = StrProp(obj, "Name");
    item["displayName"] = StrProp(obj, "DisplayName");
    item["id"] = Prop(obj, "ID");
    item["objectId"] = Prop(obj, "ObjectId");
    item["groupType"] = StrProp(obj, "GroupType");
    item["visible"] = Prop(obj, "Visible");
    return item;
};
Func<object, List<Dictionary<string, object>>> BodyInfos = (operation) => {
    var bodyInfoList = new List<Dictionary<string, object>>();
    var bodyInfoGeometry = Prop(operation, "Geometry");
    object bodyInfoCollection = Prop(bodyInfoGeometry, "Solid");
    if (bodyInfoCollection == null) bodyInfoCollection = Prop(bodyInfoGeometry, "Sheet");
    if (bodyInfoCollection == null) bodyInfoCollection = Prop(bodyInfoGeometry, "Wire");
    int bodyInfoCount = CountOf(bodyInfoCollection);
    for (int bodyInfoIndex = 0; bodyInfoIndex < bodyInfoCount; bodyInfoIndex++) {
        object bodyInfoBody = At(bodyInfoCollection, bodyInfoIndex);
        var bi = BasicInfo(bodyInfoBody);
        bi["bodyIndex"] = bodyInfoIndex;
        bi["facesCount"] = CountOf(Prop(bodyInfoBody, "Faces"));
        bi["edgesCount"] = CountOf(Prop(bodyInfoBody, "Edges"));
        bi["verticesCount"] = CountOf(Prop(bodyInfoBody, "Vertices"));
        bodyInfoList.Add(bi);
    }
    return bodyInfoList;
};
`;
}

function findersCode() {
  return `
${commonReflectionCode()}
Func<string, Operation> FindOperationByName = (operationName) => {
    if (String.IsNullOrEmpty(operationName)) return null;
    foreach (Operation findOperationCandidate in Document3D.GetOperations(document)) {
        if (String.Equals(StrProp(findOperationCandidate, "Name"), operationName, StringComparison.OrdinalIgnoreCase) ||
            String.Equals(StrProp(findOperationCandidate, "DisplayName"), operationName, StringComparison.OrdinalIgnoreCase)) return findOperationCandidate;
    }
    return null;
};
Func<IDictionary, string, bool> HasRefKey = (dict, key) => dict != null && dict.Contains(key) && dict[key] != null;
Func<IDictionary, string[], object> FirstRefValue = (dict, keys) => {
    if (dict == null) return null;
    foreach (string firstRefValueKey in keys) {
        if (dict.Contains(firstRefValueKey) && dict[firstRefValueKey] != null) return dict[firstRefValueKey];
    }
    return null;
};
Func<IDictionary, Operation> ResolveOperation = null;
ResolveOperation = (refObj) => {
    if (refObj == null) return null;
    object nestedOperation = FirstRefValue(refObj, new string[] { "operation", "ref" });
    var nestedOperationDict = nestedOperation as IDictionary;
    if (nestedOperationDict != null) {
        var nestedResolvedOperation = ResolveOperation(nestedOperationDict);
        if (nestedResolvedOperation != null) return nestedResolvedOperation;
    }
    object nameValue = FirstRefValue(refObj, new string[] { "operationName", "name", "displayName" });
    if (nameValue != null) {
        var byRefName = FindOperationByName(Convert.ToString(nameValue, CultureInfo.InvariantCulture));
        if (byRefName != null) return byRefName;
    }
    object indexValue = FirstRefValue(refObj, new string[] { "operationIndex", "index" });
    if (indexValue != null) {
        int targetIndex = Convert.ToInt32(indexValue, CultureInfo.InvariantCulture);
        int resolveOperationLoopIndex = 0;
        foreach (Operation resolveCandidate in Document3D.GetOperations(document)) {
            if (resolveOperationLoopIndex == targetIndex) return resolveCandidate;
            resolveOperationLoopIndex++;
        }
    }
    object idValue = FirstRefValue(refObj, new string[] { "id", "objectId" });
    if (idValue != null) {
        string idText = Convert.ToString(idValue, CultureInfo.InvariantCulture);
        foreach (Operation resolveByIdCandidate in Document3D.GetOperations(document)) {
            string candidateId = Convert.ToString(Prop(resolveByIdCandidate, "ID"), CultureInfo.InvariantCulture);
            string candidateObjectId = Convert.ToString(Prop(resolveByIdCandidate, "ObjectId"), CultureInfo.InvariantCulture);
            if (String.Equals(candidateId, idText, StringComparison.OrdinalIgnoreCase) ||
                String.Equals(candidateObjectId, idText, StringComparison.OrdinalIgnoreCase)) return resolveByIdCandidate;
        }
    }
    return null;
};
Func<string, LCS> FindLcsByName = (lcsName) => {
    if (String.IsNullOrEmpty(lcsName)) return null;
    foreach (LCS lcs in Document3D.GetLCSs(document)) {
        if (String.Equals(StrProp(lcs, "Name"), lcsName, StringComparison.OrdinalIgnoreCase) ||
            String.Equals(StrProp(lcs, "DisplayName"), lcsName, StringComparison.OrdinalIgnoreCase)) return lcs;
    }
    return null;
};
Func<IDictionary, object> ResolveMateElement = (refObj) => {
    if (refObj == null) return null;
    string kind = HasRefKey(refObj, "kind") ? Convert.ToString(refObj["kind"], CultureInfo.InvariantCulture).ToLowerInvariant() : "";
    if (kind == "lcs") {
        return FindLcsByName(HasRefKey(refObj, "name") ? Convert.ToString(refObj["name"], CultureInfo.InvariantCulture) : null);
    }
    Operation mateElementOperation = ResolveOperation(refObj);
    if (mateElementOperation == null) return null;
    if (kind == "operation" || (!HasRefKey(refObj, "faceIndex") && !HasRefKey(refObj, "bodyIndex"))) return mateElementOperation;
    int bodyIndex = HasRefKey(refObj, "bodyIndex") ? Convert.ToInt32(refObj["bodyIndex"], CultureInfo.InvariantCulture) : 0;
    int faceIndex = HasRefKey(refObj, "faceIndex") ? Convert.ToInt32(refObj["faceIndex"], CultureInfo.InvariantCulture) : -1;
    var mateElementBodies = BodyInfos(mateElementOperation);
    var mateElementGeometry = Prop(mateElementOperation, "Geometry");
    object mateElementBodyCollection = Prop(mateElementGeometry, "Solid");
    if (mateElementBodyCollection == null) mateElementBodyCollection = Prop(mateElementGeometry, "Sheet");
    if (mateElementBodyCollection == null) mateElementBodyCollection = Prop(mateElementGeometry, "Wire");
    object body = At(mateElementBodyCollection, bodyIndex);
    if (faceIndex < 0) return body;
    return At(Prop(body, "Faces"), faceIndex);
};
`;
}

function listModelObjectsCode() {
  return `
${commonReflectionCode()}
var result = new Dictionary<string, object>();

var operations = new List<Dictionary<string, object>>();
int opIndex = 0;
foreach (Operation op in Document3D.GetOperations(document)) {
    var item = BasicInfo(op);
    item["kind"] = "operation";
    item["index"] = opIndex;
    var bodies = BodyInfos(op);
    item["bodyCount"] = bodies.Count;
    item["bodies"] = bodies;
    operations.Add(item);
    opIndex++;
}
result["operations"] = operations;

var profiles = new List<Dictionary<string, object>>();
int profileIndex = 0;
foreach (Profile profile in Document3D.GetProfiles(document)) {
    var item = BasicInfo(profile);
    item["kind"] = "profile";
    item["index"] = profileIndex++;
    profiles.Add(item);
}
result["profiles"] = profiles;

var lcss = new List<Dictionary<string, object>>();
int lcsIndex = 0;
foreach (LCS lcs in Document3D.GetLCSs(document)) {
    var item = BasicInfo(lcs);
    item["kind"] = "lcs";
    item["index"] = lcsIndex++;
    item["useForFragmentFixing"] = Prop(lcs, "UseForFragmentFixing");
    lcss.Add(item);
}
result["lcss"] = lcss;

var fragments = new List<Dictionary<string, object>>();
int fragmentIndex = 0;
foreach (Fragment3D fragment in Document3D.GetFragments3D(document)) {
    var item = BasicInfo(fragment);
    item["kind"] = "fragment";
    item["index"] = fragmentIndex++;
    item["fileLink"] = Convert.ToString(Prop(fragment, "FileLink"), CultureInfo.InvariantCulture);
    item["sourceLCSName"] = StrProp(fragment, "SourceLCSName");
    fragments.Add(item);
}
result["fragments"] = fragments;

var mates = new List<Dictionary<string, object>>();
int mateIndex = 0;
foreach (Mate mate in Document3D.GetMates(document)) {
    var item = BasicInfo(mate);
    item["kind"] = "mate";
    item["index"] = mateIndex++;
    item["mateType"] = StrProp(mate, "Type");
    item["suppressed"] = Prop(mate, "Suppressed");
    item["distance"] = Prop(mate, "DistanceValue");
    item["angle"] = Prop(mate, "AngleValue");
    mates.Add(item);
}
result["mates"] = mates;

result["counts"] = new Dictionary<string, object> {
    { "operations", operations.Count },
    { "profiles", profiles.Count },
    { "lcss", lcss.Count },
    { "fragments", fragments.Count },
    { "mates", mates.Count }
};
return result;
`;
}

function findObjectCode() {
  return `
${commonReflectionCode()}
string query = Convert.ToString(args["query"], CultureInfo.InvariantCulture);
string kind = args.ContainsKey("kind") && args["kind"] != null ? Convert.ToString(args["kind"], CultureInfo.InvariantCulture).ToLowerInvariant() : "any";
Func<string, bool> KindOk = (candidate) => kind == "any" || kind == candidate;
Func<object, string, int, Dictionary<string, object>> Match = (obj, candidateKind, index) => {
    var name = StrProp(obj, "Name") ?? "";
    var display = StrProp(obj, "DisplayName") ?? "";
    if (name.IndexOf(query, StringComparison.OrdinalIgnoreCase) < 0 &&
        display.IndexOf(query, StringComparison.OrdinalIgnoreCase) < 0) return null;
    var item = BasicInfo(obj);
    item["kind"] = candidateKind;
    item["index"] = index;
    return item;
};
var found = new List<Dictionary<string, object>>();
if (KindOk("operation")) { int i = 0; foreach (Operation x in Document3D.GetOperations(document)) { var m = Match(x, "operation", i++); if (m != null) found.Add(m); } }
if (KindOk("profile")) { int i = 0; foreach (Profile x in Document3D.GetProfiles(document)) { var m = Match(x, "profile", i++); if (m != null) found.Add(m); } }
if (KindOk("lcs")) { int i = 0; foreach (LCS x in Document3D.GetLCSs(document)) { var m = Match(x, "lcs", i++); if (m != null) found.Add(m); } }
if (KindOk("fragment")) { int i = 0; foreach (Fragment3D x in Document3D.GetFragments3D(document)) { var m = Match(x, "fragment", i++); if (m != null) found.Add(m); } }
if (KindOk("mate")) { int i = 0; foreach (Mate x in Document3D.GetMates(document)) { var m = Match(x, "mate", i++); if (m != null) found.Add(m); } }
return new Dictionary<string, object> { { "query", query }, { "count", found.Count }, { "objects", found } };
`;
}

function listOperationFacesCode() {
  return `
${findersCode()}
Operation op = null;
if (args.ContainsKey("operationName") && args["operationName"] != null)
    op = FindOperationByName(Convert.ToString(args["operationName"], CultureInfo.InvariantCulture));
if (op == null && args.ContainsKey("operationIndex") && args["operationIndex"] != null) {
    int targetIndex = Convert.ToInt32(args["operationIndex"], CultureInfo.InvariantCulture);
    int i = 0;
    foreach (Operation candidate in Document3D.GetOperations(document)) {
        if (i == targetIndex) { op = candidate; break; }
        i++;
    }
}
if (op == null) throw new InvalidOperationException("Operation not found. Pass operationName or operationIndex.");
bool includeEdges = args.ContainsKey("includeEdges") && Convert.ToBoolean(args["includeEdges"], CultureInfo.InvariantCulture);

var operationInfo = BasicInfo(op);
var resultBodies = new List<Dictionary<string, object>>();
var geometry = Prop(op, "Geometry");
object bodyCollection = Prop(geometry, "Solid");
if (bodyCollection == null) bodyCollection = Prop(geometry, "Sheet");
if (bodyCollection == null) bodyCollection = Prop(geometry, "Wire");
int bodyCount = CountOf(bodyCollection);
for (int b = 0; b < bodyCount; b++) {
    object body = At(bodyCollection, b);
    var bodyInfo = BasicInfo(body);
    bodyInfo["bodyIndex"] = b;
    var faces = new List<Dictionary<string, object>>();
    object faceCollection = Prop(body, "Faces");
    int faceCount = CountOf(faceCollection);
    for (int f = 0; f < faceCount; f++) {
        object face = At(faceCollection, f);
        var faceInfo = BasicInfo(face);
        faceInfo["kind"] = "face";
        faceInfo["operationName"] = StrProp(op, "Name");
        faceInfo["operationIndex"] = args.ContainsKey("operationIndex") ? args["operationIndex"] : null;
        faceInfo["bodyIndex"] = b;
        faceInfo["faceIndex"] = f;
        faceInfo["surfaceType"] = Prop(Prop(face, "Surface"), "GetType") == null ? (Prop(face, "Surface") == null ? null : Prop(face, "Surface").GetType().FullName) : null;
        faceInfo["sense"] = StrProp(face, "Sense");
        faceInfo["edgesCount"] = CountOf(Prop(face, "Edges"));
        faceInfo["verticesCount"] = CountOf(Prop(face, "Vertices"));
        if (includeEdges) {
            var edges = new List<Dictionary<string, object>>();
            object edgeCollection = Prop(face, "Edges");
            int edgeCount = CountOf(edgeCollection);
            for (int e = 0; e < edgeCount; e++) {
                var edge = At(edgeCollection, e);
                var edgeInfo = BasicInfo(edge);
                edgeInfo["edgeIndex"] = e;
                edges.Add(edgeInfo);
            }
            faceInfo["edges"] = edges;
        }
        faces.Add(faceInfo);
    }
    bodyInfo["facesCount"] = faces.Count;
    bodyInfo["faces"] = faces;
    resultBodies.Add(bodyInfo);
}
return new Dictionary<string, object> { { "operation", operationInfo }, { "bodies", resultBodies } };
`;
}

function listMateTargetsCode() {
  return `
${commonReflectionCode()}
bool includeFaces = !args.ContainsKey("includeFaces") || Convert.ToBoolean(args["includeFaces"], CultureInfo.InvariantCulture);
int maxFaces = args.ContainsKey("maxFaces") && args["maxFaces"] != null ? Convert.ToInt32(args["maxFaces"], CultureInfo.InvariantCulture) : 200;
var targets = new List<Dictionary<string, object>>();
int lcsIndex = 0;
foreach (LCS lcs in Document3D.GetLCSs(document)) {
    var item = BasicInfo(lcs);
    item["kind"] = "lcs";
    item["index"] = lcsIndex++;
    targets.Add(item);
}
int fragmentIndex = 0;
foreach (Fragment3D fragment in Document3D.GetFragments3D(document)) {
    var item = BasicInfo(fragment);
    item["kind"] = "fragment";
    item["index"] = fragmentIndex++;
    targets.Add(item);
}
int opIndex = 0;
int faceSeen = 0;
foreach (Operation op in Document3D.GetOperations(document)) {
    var opItem = BasicInfo(op);
    opItem["kind"] = "operation";
    opItem["index"] = opIndex;
    targets.Add(opItem);
    if (includeFaces && faceSeen < maxFaces) {
        var geometry = Prop(op, "Geometry");
        object bodyCollection = Prop(geometry, "Solid");
        if (bodyCollection == null) bodyCollection = Prop(geometry, "Sheet");
        if (bodyCollection == null) bodyCollection = Prop(geometry, "Wire");
        int bodyCount = CountOf(bodyCollection);
        for (int b = 0; b < bodyCount && faceSeen < maxFaces; b++) {
            object body = At(bodyCollection, b);
            object faces = Prop(body, "Faces");
            int faceCount = CountOf(faces);
            for (int f = 0; f < faceCount && faceSeen < maxFaces; f++) {
                object face = At(faces, f);
                var faceItem = BasicInfo(face);
                faceItem["kind"] = "face";
                faceItem["operationName"] = StrProp(op, "Name");
                faceItem["operationIndex"] = opIndex;
                faceItem["bodyIndex"] = b;
                faceItem["faceIndex"] = f;
                faceItem["surfaceType"] = Prop(face, "Surface") == null ? null : Prop(face, "Surface").GetType().FullName;
                faceItem["edgesCount"] = CountOf(Prop(face, "Edges"));
                targets.Add(faceItem);
                faceSeen++;
            }
        }
    }
    opIndex++;
}
return new Dictionary<string, object> { { "count", targets.Count }, { "targets", targets }, { "facesTruncated", includeFaces && faceSeen >= maxFaces } };
`;
}

function createLcsByPointsCode() {
  return `
${commonReflectionCode()}
Func<object, double[]> Point = (value) => {
    var list = value as IList;
    if (list == null || list.Count < 3) throw new InvalidOperationException("Point must be an array [x, y, z].");
    return new double[] {
        Convert.ToDouble(list[0], CultureInfo.InvariantCulture),
        Convert.ToDouble(list[1], CultureInfo.InvariantCulture),
        Convert.ToDouble(list[2], CultureInfo.InvariantCulture)
    };
};
Action<CoordinateNode3D, double[]> SetNode = (node, p) => { node.X = p[0]; node.Y = p[1]; node.Z = p[2]; };
string name = Convert.ToString(args["name"], CultureInfo.InvariantCulture);
double[] origin = Point(args["origin"]);
double[] xPoint = Point(args["xPoint"]);
double[] yPoint = Point(args["yPoint"]);
bool useForFragment = !args.ContainsKey("useForFragment") || Convert.ToBoolean(args["useForFragment"], CultureInfo.InvariantCulture);
var n1 = new CoordinateNode3D(document); SetNode(n1, origin);
var n2 = new CoordinateNode3D(document); SetNode(n2, xPoint);
var n3 = new CoordinateNode3D(document); SetNode(n3, yPoint);
var lcs = new PointsLCS(document);
lcs.PointToOrigin = n1.Geometry.Point;
lcs.PointToAxisX = n2.Geometry.Point;
lcs.PointToAxisY = n3.Geometry.Point;
lcs.UseForFragment = useForFragment;
SetProp(lcs, "Name", name);
return new Dictionary<string, object> { { "kind", "lcs" }, { "name", StrProp(lcs, "Name") }, { "type", lcs.GetType().FullName }, { "origin", origin }, { "xPoint", xPoint }, { "yPoint", yPoint } };
`;
}

function createLcsByTransformCode() {
  return `
${commonReflectionCode()}
Func<object, double[]> Point = (value) => {
    var list = value as IList;
    if (list == null || list.Count < 3) throw new InvalidOperationException("Point must be an array [x, y, z].");
    return new double[] {
        Convert.ToDouble(list[0], CultureInfo.InvariantCulture),
        Convert.ToDouble(list[1], CultureInfo.InvariantCulture),
        Convert.ToDouble(list[2], CultureInfo.InvariantCulture)
    };
};
Func<double[], double[], double[]> Rotate = (v, rDeg) => {
    double rx = rDeg[0] * Math.PI / 180.0, ry = rDeg[1] * Math.PI / 180.0, rz = rDeg[2] * Math.PI / 180.0;
    double x = v[0], y = v[1], z = v[2];
    double cy = Math.Cos(rx), sy = Math.Sin(rx);
    double y1 = y * cy - z * sy, z1 = y * sy + z * cy; y = y1; z = z1;
    double cx = Math.Cos(ry), sx = Math.Sin(ry);
    double x1 = x * cx + z * sx, z2 = -x * sx + z * cx; x = x1; z = z2;
    double cz = Math.Cos(rz), sz = Math.Sin(rz);
    double x2 = x * cz - y * sz, y2 = x * sz + y * cz; x = x2; y = y2;
    return new double[] { x, y, z };
};
Action<CoordinateNode3D, double[]> SetNode = (node, p) => { node.X = p[0]; node.Y = p[1]; node.Z = p[2]; };
string name = Convert.ToString(args["name"], CultureInfo.InvariantCulture);
double[] origin = Point(args["origin"]);
double[] rotation = args.ContainsKey("rotation") && args["rotation"] != null ? Point(args["rotation"]) : new double[] { 0, 0, 0 };
double axisLength = args.ContainsKey("axisLength") && args["axisLength"] != null ? Convert.ToDouble(args["axisLength"], CultureInfo.InvariantCulture) : 100.0;
bool useForFragment = !args.ContainsKey("useForFragment") || Convert.ToBoolean(args["useForFragment"], CultureInfo.InvariantCulture);
double[] xAxis = Rotate(new double[] { axisLength, 0, 0 }, rotation);
double[] yAxis = Rotate(new double[] { 0, axisLength, 0 }, rotation);
double[] xPoint = new double[] { origin[0] + xAxis[0], origin[1] + xAxis[1], origin[2] + xAxis[2] };
double[] yPoint = new double[] { origin[0] + yAxis[0], origin[1] + yAxis[1], origin[2] + yAxis[2] };
var n1 = new CoordinateNode3D(document); SetNode(n1, origin);
var n2 = new CoordinateNode3D(document); SetNode(n2, xPoint);
var n3 = new CoordinateNode3D(document); SetNode(n3, yPoint);
var lcs = new PointsLCS(document);
lcs.PointToOrigin = n1.Geometry.Point;
lcs.PointToAxisX = n2.Geometry.Point;
lcs.PointToAxisY = n3.Geometry.Point;
lcs.UseForFragment = useForFragment;
SetProp(lcs, "Name", name);
return new Dictionary<string, object> { { "kind", "lcs" }, { "name", StrProp(lcs, "Name") }, { "origin", origin }, { "rotation", rotation }, { "xPoint", xPoint }, { "yPoint", yPoint } };
`;
}

function extrudeProfileCode() {
  return `
${commonReflectionCode()}
Profile profile = null;
if (args.ContainsKey("profileName") && args["profileName"] != null) {
    string profileName = Convert.ToString(args["profileName"], CultureInfo.InvariantCulture);
    foreach (Profile candidate in Document3D.GetProfiles(document)) {
        if (String.Equals(StrProp(candidate, "Name"), profileName, StringComparison.OrdinalIgnoreCase) ||
            String.Equals(StrProp(candidate, "DisplayName"), profileName, StringComparison.OrdinalIgnoreCase)) { profile = candidate; break; }
    }
}
if (profile == null && args.ContainsKey("profileIndex") && args["profileIndex"] != null) {
    int target = Convert.ToInt32(args["profileIndex"], CultureInfo.InvariantCulture);
    int i = 0;
    foreach (Profile candidate in Document3D.GetProfiles(document)) {
        if (i == target) { profile = candidate; break; }
        i++;
    }
}
if (profile == null) throw new InvalidOperationException("Profile not found. Pass profileName or profileIndex.");
double distance = Convert.ToDouble(args["distance"], CultureInfo.InvariantCulture);
double backward = args.ContainsKey("backwardDistance") && args["backwardDistance"] != null ? Convert.ToDouble(args["backwardDistance"], CultureInfo.InvariantCulture) : 0.0;
var ext = new ThickenExtrusion(document);
if (backward != 0) {
    ext.LengthType = ThickenExtrusion.LengthValue.ValueValue;
    ext.ForwardLength = distance;
    ext.BackwardLength = backward;
} else {
    ext.LengthType = ThickenExtrusion.LengthValue.AutoValue;
    ext.ForwardLength = distance;
}
ext.Profile.Add(profile.Geometry.SheetContour);
if (args.ContainsKey("operationName") && args["operationName"] != null)
    SetProp(ext, "Name", Convert.ToString(args["operationName"], CultureInfo.InvariantCulture));
ext.Regenerate(true);
var bodies = BodyInfos(ext);
return new Dictionary<string, object> { { "kind", "operation" }, { "name", StrProp(ext, "Name") }, { "type", ext.GetType().FullName }, { "bodyCount", bodies.Count }, { "bodies", bodies } };
`;
}

function booleanCode() {
  return `
${findersCode()}
Func<string[], object> FirstArgValue = (keys) => {
    foreach (string firstArgValueKey in keys) {
        if (args.ContainsKey(firstArgValueKey) && args[firstArgValueKey] != null) return args[firstArgValueKey];
    }
    return null;
};
Func<object, string> RefSummary = (value) => {
    if (value == null) return "<null>";
    var dict = value as IDictionary;
    if (dict == null) return Convert.ToString(value, CultureInfo.InvariantCulture);
    var parts = new List<string>();
    foreach (DictionaryEntry entry in dict) {
        string refSummaryKey = Convert.ToString(entry.Key, CultureInfo.InvariantCulture);
        object refSummaryValue = entry.Value;
        if (refSummaryValue is IDictionary || refSummaryValue is IList) continue;
        parts.Add(refSummaryKey + "=" + Convert.ToString(refSummaryValue, CultureInfo.InvariantCulture));
    }
    return "{" + String.Join(", ", parts.ToArray()) + "}";
};
Func<object, List<Operation>> ResolveOperands = (value) => {
    var list = value as IList;
    if (list == null) throw new InvalidOperationException("Operands must be arrays of operation references.");
    var result = new List<Operation>();
    foreach (object item in list) {
        Operation operandOperation = null;
        var dict = item as IDictionary;
        if (dict != null) {
            operandOperation = ResolveOperation(dict);
        } else if (item is string) {
            operandOperation = FindOperationByName(Convert.ToString(item, CultureInfo.InvariantCulture));
        } else if (item != null) {
            int operandIndex;
            if (!Int32.TryParse(Convert.ToString(item, CultureInfo.InvariantCulture), NumberStyles.Any, CultureInfo.InvariantCulture, out operandIndex))
                operandIndex = -1;
            int operandLoopIndex = 0;
            foreach (Operation operandCandidate in Document3D.GetOperations(document)) {
                if (operandLoopIndex == operandIndex) { operandOperation = operandCandidate; break; }
                operandLoopIndex++;
            }
        }
        if (operandOperation == null) throw new InvalidOperationException("Boolean operand operation not found. Reference: " + RefSummary(item));
        result.Add(operandOperation);
    }
    return result;
};
object typeObject = FirstArgValue(new string[] { "type", "booleanType", "function" });
if (typeObject == null) throw new InvalidOperationException("Missing boolean type. Use type: unite, subtract, or intersect.");
object firstObject = FirstArgValue(new string[] { "firstOperands", "first", "targets", "targetOperands", "baseOperands" });
if (firstObject == null) throw new InvalidOperationException("Missing boolean first operands. Use firstOperands: [{ name/index/operationName }].");
object secondObject = FirstArgValue(new string[] { "secondOperands", "second", "tools", "toolOperands", "cutters" });
if (secondObject == null) throw new InvalidOperationException("Missing boolean second operands. Use secondOperands: [{ name/index/operationName }].");
string type = Convert.ToString(typeObject, CultureInfo.InvariantCulture).ToLowerInvariant();
var first = ResolveOperands(firstObject);
var second = ResolveOperands(secondObject);
bool keepVisible = args.ContainsKey("keepOperandsVisible") && Convert.ToBoolean(args["keepOperandsVisible"], CultureInfo.InvariantCulture);
var bo = new BooleanOperation(document);
foreach (Operation firstOperandOperation in first) bo.FirstOperands.Add(new BooleanOperation.OperandsArray.Operand(firstOperandOperation, keepVisible));
foreach (Operation secondOperandOperation in second) bo.SecondOperands.Add(new BooleanOperation.OperandsArray.Operand(secondOperandOperation, keepVisible));
if (type == "unite") bo.Function = BooleanOperation.FunctionType.Unite;
else if (type == "subtract") bo.Function = BooleanOperation.FunctionType.Subtract;
else if (type == "intersect") bo.Function = BooleanOperation.FunctionType.Intersect;
else throw new InvalidOperationException("Unsupported boolean type: " + type);
if (args.ContainsKey("operationName") && args["operationName"] != null)
    SetProp(bo, "Name", Convert.ToString(args["operationName"], CultureInfo.InvariantCulture));
bo.Regenerate(true);
var bodies = BodyInfos(bo);
return new Dictionary<string, object> { { "kind", "operation" }, { "name", StrProp(bo, "Name") }, { "booleanType", type }, { "bodyCount", bodies.Count }, { "bodies", bodies } };
`;
}

function insertFragmentCode() {
  return `
${commonReflectionCode()}
string path = Convert.ToString(args["fragmentPath"], CultureInfo.InvariantCulture);
if (!File.Exists(path)) throw new FileNotFoundException("Fragment file not found", path);
var fragment = new Fragment3D(path, document);
if (args.ContainsKey("name") && args["name"] != null)
    SetProp(fragment, "Name", Convert.ToString(args["name"], CultureInfo.InvariantCulture));
return new Dictionary<string, object> { { "kind", "fragment" }, { "name", StrProp(fragment, "Name") }, { "path", path }, { "type", fragment.GetType().FullName } };
`;
}

function insertFragmentAtLcsCode() {
  return `
${findersCode()}
string path = Convert.ToString(args["fragmentPath"], CultureInfo.InvariantCulture);
if (!File.Exists(path)) throw new FileNotFoundException("Fragment file not found", path);
string sourceLcsName = Convert.ToString(args["sourceLcsName"], CultureInfo.InvariantCulture);
string targetLcsName = Convert.ToString(args["targetLcsName"], CultureInfo.InvariantCulture);
LCS target = FindLcsByName(targetLcsName);
if (target == null) throw new InvalidOperationException("Target LCS not found: " + targetLcsName);
var fragment = new Fragment3D(path, document);
fragment.FixByFragmentLCS(sourceLcsName, target);
if (args.ContainsKey("name") && args["name"] != null)
    SetProp(fragment, "Name", Convert.ToString(args["name"], CultureInfo.InvariantCulture));
return new Dictionary<string, object> { { "kind", "fragment" }, { "name", StrProp(fragment, "Name") }, { "path", path }, { "sourceLcsName", sourceLcsName }, { "targetLcsName", targetLcsName } };
`;
}

function createMateCode() {
  return `
${findersCode()}
var target1 = args["target1"] as IDictionary;
var target2 = args["target2"] as IDictionary;
object element1 = ResolveMateElement(target1);
object element2 = ResolveMateElement(target2);
if (element1 == null) throw new InvalidOperationException("Mate target1 not resolved.");
if (element2 == null) throw new InvalidOperationException("Mate target2 not resolved.");
Operation operation1 = ResolveOperation(target1);
Operation operation2 = ResolveOperation(target2);
var mate = new Mate(document);
SetProp(mate, "Element1", element1);
SetProp(mate, "Element2", element2);
if (operation1 != null) SetProp(mate, "Operation1", operation1);
if (operation2 != null) SetProp(mate, "Operation2", operation2);
string typeText = Convert.ToString(args["type"], CultureInfo.InvariantCulture);
var aliases = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
    { "coincident", "Coincidence" },
    { "coincidence", "Coincidence" },
    { "distance", "Distance" },
    { "angle", "Angle" },
    { "concentric", "Concentric" },
    { "parallel", "Parallel" },
    { "perpendicular", "Perpendicular" },
    { "fix", "Fix" }
};
string enumName = aliases.ContainsKey(typeText) ? aliases[typeText] : typeText;
var typeProp = mate.GetType().GetProperty("Type");
if (typeProp == null) throw new InvalidOperationException("Mate.Type property is not available.");
try {
    object enumValue = Enum.Parse(typeProp.PropertyType, enumName, true);
    typeProp.SetValue(mate, enumValue, null);
} catch (Exception ex) {
    var names = String.Join(", ", Enum.GetNames(typeProp.PropertyType));
    throw new InvalidOperationException("Unsupported mate type '" + typeText + "'. Available T-FLEX names: " + names, ex);
}
if (args.ContainsKey("distance") && args["distance"] != null) SetProp(mate, "DistanceValue", Convert.ToDouble(args["distance"], CultureInfo.InvariantCulture));
if (args.ContainsKey("angle") && args["angle"] != null) SetProp(mate, "AngleValue", Convert.ToDouble(args["angle"], CultureInfo.InvariantCulture));
if (args.ContainsKey("reversedNormal") && args["reversedNormal"] != null) SetProp(mate, "ReversedNormal", Convert.ToBoolean(args["reversedNormal"], CultureInfo.InvariantCulture));
if (args.ContainsKey("reversedDirection") && args["reversedDirection"] != null) SetProp(mate, "ReversedDirection", Convert.ToBoolean(args["reversedDirection"], CultureInfo.InvariantCulture));
if (args.ContainsKey("name") && args["name"] != null) SetProp(mate, "Name", Convert.ToString(args["name"], CultureInfo.InvariantCulture));
return new Dictionary<string, object> { { "kind", "mate" }, { "name", StrProp(mate, "Name") }, { "type", StrProp(mate, "Type") }, { "target1Type", element1.GetType().FullName }, { "target2Type", element2.GetType().FullName } };
`;
}

function listMatesCode() {
  return `
${commonReflectionCode()}
var mates = new List<Dictionary<string, object>>();
int mateListIndex = 0;
foreach (Mate mate in Document3D.GetMates(document)) {
    var item = BasicInfo(mate);
    item["kind"] = "mate";
    item["index"] = mateListIndex++;
    item["mateType"] = StrProp(mate, "Type");
    item["suppressed"] = Prop(mate, "Suppressed");
    item["distance"] = Prop(mate, "DistanceValue");
    item["angle"] = Prop(mate, "AngleValue");
    item["operation1"] = BasicInfo(Prop(mate, "Operation1"));
    item["operation2"] = BasicInfo(Prop(mate, "Operation2"));
    item["element1Type"] = Prop(mate, "Element1") == null ? null : Prop(mate, "Element1").GetType().FullName;
    item["element2Type"] = Prop(mate, "Element2") == null ? null : Prop(mate, "Element2").GetType().FullName;
    mates.Add(item);
}
return new Dictionary<string, object> { { "count", mates.Count }, { "mates", mates } };
`;
}

function suppressMateCode() {
  return `
${commonReflectionCode()}
Mate mate = null;
if (args.ContainsKey("mateName") && args["mateName"] != null) {
    string mateName = Convert.ToString(args["mateName"], CultureInfo.InvariantCulture);
    foreach (Mate candidate in Document3D.GetMates(document)) {
        if (String.Equals(StrProp(candidate, "Name"), mateName, StringComparison.OrdinalIgnoreCase) ||
            String.Equals(StrProp(candidate, "DisplayName"), mateName, StringComparison.OrdinalIgnoreCase)) { mate = candidate; break; }
    }
}
if (mate == null && args.ContainsKey("mateIndex") && args["mateIndex"] != null) {
    int target = Convert.ToInt32(args["mateIndex"], CultureInfo.InvariantCulture);
    int suppressMateLoopIndex = 0;
    foreach (Mate candidate in Document3D.GetMates(document)) {
        if (suppressMateLoopIndex == target) { mate = candidate; break; }
        suppressMateLoopIndex++;
    }
}
if (mate == null) throw new InvalidOperationException("Mate not found. Pass mateName or mateIndex.");
bool suppressed = Convert.ToBoolean(args["suppressed"], CultureInfo.InvariantCulture);
mate.Suppressed = suppressed;
return new Dictionary<string, object> { { "kind", "mate" }, { "name", StrProp(mate, "Name") }, { "suppressed", mate.Suppressed }, { "type", StrProp(mate, "Type") } };
`;
}

function renameLastOperationCode() {
  return `
${commonReflectionCode()}
Operation last = null;
int lastOperationIndex = -1;
int renameOperationLoopIndex = 0;
foreach (Operation renameCandidate in Document3D.GetOperations(document)) {
    last = renameCandidate;
    lastOperationIndex = renameOperationLoopIndex++;
}
if (last == null) throw new InvalidOperationException("No 3D operations found.");
string name = Convert.ToString(args["name"], CultureInfo.InvariantCulture);
SetProp(last, "Name", name);
return new Dictionary<string, object> { { "kind", "operation" }, { "index", lastOperationIndex }, { "name", StrProp(last, "Name") }, { "type", last.GetType().FullName } };
`;
}
