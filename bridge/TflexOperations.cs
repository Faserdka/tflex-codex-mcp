using System;
using System.CodeDom.Compiler;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using Microsoft.CSharp;
using TFlex.Model;

namespace TflexCodexBridge
{
    public sealed class TflexOperations
    {
        public Dictionary<string, object> Execute(string command, Dictionary<string, object> args)
        {
            switch ((command ?? "").ToLowerInvariant())
            {
                case "ping":
                    return Ok("bridge", "T-FLEX bridge is running");
                case "active_document":
                    return ActiveDocument();
                case "open_document":
                    return OpenDocument(RequireString(args, "path"));
                case "list_variables":
                    return ListVariables();
                case "set_variable":
                    return SetVariable(args, false);
                case "create_variable":
                    return SetVariable(args, true);
                case "rebuild":
                    return Rebuild(ArgBool(args, "full", true));
                case "save":
                    return Save();
                case "save_as":
                    return SaveAs(RequireString(args, "path"));
                case "export":
                    return Export(RequireString(args, "format"), RequireString(args, "path"));
                case "execute_csharp":
                    return ExecuteCSharp(args);
                default:
                    throw new InvalidOperationException("Unknown command: " + command);
            }
        }

        private Dictionary<string, object> ActiveDocument()
        {
            Document doc = RequireActiveDocument();
            return Ok("document", DocumentInfo(doc));
        }

        private Dictionary<string, object> OpenDocument(string path)
        {
            if (!File.Exists(path))
                throw new FileNotFoundException("Document not found", path);

            Document doc = TFlex.Application.OpenDocument(path);
            return Ok("document", DocumentInfo(doc));
        }

        private Dictionary<string, object> ListVariables()
        {
            Document doc = RequireActiveDocument();
            var result = new List<Dictionary<string, object>>();
            foreach (Variable variable in doc.GetVariables())
                result.Add(VariableInfo(variable));

            var response = Ok("variables", result);
            response["count"] = result.Count;
            return response;
        }

        private Dictionary<string, object> SetVariable(Dictionary<string, object> args, bool create)
        {
            Document doc = RequireActiveDocument();
            string name = RequireString(args, "name");
            object value = args.ContainsKey("value") ? args["value"] : null;
            string mode = ArgString(args, "mode", "auto").ToLowerInvariant();
            bool rebuild = ArgBool(args, "rebuild", true);

            Variable variable = FindVariable(doc, name);
            if (variable == null && !create)
                throw new InvalidOperationException("Variable not found: " + name);

            doc.BeginChanges(create ? "Codex create variable" : "Codex set variable");
            try
            {
                if (variable == null)
                    variable = CreateVariable(doc, name, value, mode);
                else
                    ApplyValue(variable, value, mode);

                doc.EndChanges();
            }
            catch
            {
                TryCancelChanges(doc);
                throw;
            }

            if (rebuild)
                TryRebuild(doc, true);

            return Ok("variable", VariableInfo(variable));
        }

        private Dictionary<string, object> Rebuild(bool full)
        {
            Document doc = RequireActiveDocument();
            TryRebuild(doc, full);
            return Ok("rebuilt", true);
        }

        private Dictionary<string, object> Save()
        {
            Document doc = RequireActiveDocument();
            doc.Save();
            return Ok("saved", true);
        }

        private Dictionary<string, object> SaveAs(string path)
        {
            Document doc = RequireActiveDocument();
            EnsureParent(path);
            doc.SaveAs(path);
            return Ok("path", path);
        }

        private Dictionary<string, object> Export(string format, string path)
        {
            Document doc = RequireActiveDocument();
            EnsureParent(path);
            string normalized = format.ToLowerInvariant();

            if (normalized == "copy")
            {
                doc.SaveCopy(path);
            }
            else if (normalized == "variables")
            {
                doc.ExportVariables.Export(path);
            }
            else if (normalized == "step" || normalized == "stp")
            {
                var exporter = new ExportToStep(doc);
                exporter.ShowDialog = false;
                exporter.Export(path);
            }
            else if (normalized == "pdf")
            {
                var exporter = new ExportToPDF(doc);
                exporter.OpenExportFile = false;
                exporter.Export(path);
            }
            else
            {
                throw new InvalidOperationException("Unsupported export format: " + format);
            }

            return Ok("path", path);
        }

        private Dictionary<string, object> ExecuteCSharp(Dictionary<string, object> args)
        {
            string code;
            string description;
            string documentPath;
            string saveAsPath;
            bool save;
            Dictionary<string, object> scriptArgs;
            try
            {
                code = RequireString(args, "code");
                description = ArgString(args, "description", "Codex execute C#");
                documentPath = ArgString(args, "documentPath", null);
                saveAsPath = ArgString(args, "saveAsPath", null);
                save = ArgBool(args, "save", false);
                scriptArgs = ArgDictionary(args, "scriptArgs");
            }
            catch (Exception ex)
            {
                return Error("prepare", ex.Message, ex.GetType().FullName, null);
            }

            CompilerResults compileResult = CompileScript(code);
            if (compileResult.Errors.HasErrors)
                return CompileError(compileResult.Errors);

            MethodInfo runMethod = compileResult.CompiledAssembly
                .GetType("TflexCodexBridge.Dynamic.CodexScript")
                .GetMethod("Run", BindingFlags.Public | BindingFlags.Static);

            Document doc;
            try
            {
                doc = string.IsNullOrEmpty(documentPath)
                    ? RequireActiveDocument()
                    : OpenDocumentForScript(documentPath);
            }
            catch (Exception ex)
            {
                return Error("prepare", ex.Message, ex.GetType().FullName, null);
            }

            bool changesStarted = false;
            try
            {
                doc.BeginChanges(description);
                changesStarted = true;

                object result = runMethod.Invoke(null, new object[] { doc, scriptArgs });

                doc.EndChanges();
                changesStarted = false;

                var response = Ok("result", NormalizeForJson(result, 0));
                response["resultType"] = result == null ? null : result.GetType().FullName;
                response["document"] = DocumentInfo(doc);

                if (!string.IsNullOrEmpty(saveAsPath))
                {
                    EnsureParent(saveAsPath);
                    doc.SaveAs(saveAsPath);
                    response["saved"] = true;
                    response["savedAsPath"] = saveAsPath;
                }
                else if (save)
                {
                    doc.Save();
                    response["saved"] = true;
                }
                else
                {
                    response["saved"] = false;
                }

                return response;
            }
            catch (Exception ex)
            {
                if (changesStarted)
                    TryCancelChanges(doc);

                Exception actual = ex is TargetInvocationException && ex.InnerException != null
                    ? ex.InnerException
                    : ex;

                return Error("runtime", actual.Message, actual.GetType().FullName, actual.StackTrace);
            }
        }

        private static Document OpenDocumentForScript(string path)
        {
            if (!File.Exists(path))
                throw new FileNotFoundException("Document not found", path);
            return TFlex.Application.OpenDocument(path);
        }

        private static CompilerResults CompileScript(string code)
        {
            string source = BuildScriptSource(code);
            using (var provider = new CSharpCodeProvider())
            {
                var parameters = new CompilerParameters();
                parameters.GenerateExecutable = false;
                parameters.GenerateInMemory = true;
                parameters.IncludeDebugInformation = false;
                parameters.TreatWarningsAsErrors = false;
                parameters.WarningLevel = 3;
                parameters.CompilerOptions = "/optimize";

                AddDefaultReferences(parameters);
                return provider.CompileAssemblyFromSource(parameters, source);
            }
        }

        private static string BuildScriptSource(string code)
        {
            return @"
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using TFlex;
using TFlex.Model;
using TFlex.Model.Model2D;
using TFlex.Model.Model3D;
using TFlex.Model.Model3D.Geometry;
using TflexCodexBridge;

namespace TflexCodexBridge.Dynamic
{
    public static class CodexScript
    {
        public static object Run(Document document, Dictionary<string, object> args)
        {
" + code + @"
            return null;
        }
    }
}
";
        }

        private static void AddDefaultReferences(CompilerParameters parameters)
        {
            AddReference(parameters, "System.dll");
            AddReference(parameters, "System.Core.dll");
            AddReference(parameters, "System.Data.dll");
            AddReference(parameters, "System.Drawing.dll");
            AddReference(parameters, "System.Windows.Forms.dll");
            AddReference(parameters, "System.Xml.dll");
            AddReference(parameters, "System.Web.Extensions.dll");
            AddReference(parameters, typeof(TflexOperations).Assembly.Location);
            AddReference(parameters, typeof(Document).Assembly.Location);

            string apiDir = Path.GetDirectoryName(typeof(Document).Assembly.Location);
            AddReference(parameters, Path.Combine(apiDir, "TFlexAPI.dll"));
            AddReference(parameters, Path.Combine(apiDir, "TFlexAPI3D.dll"));
            AddReference(parameters, Path.Combine(apiDir, "TFlexCommandAPI.dll"));
            AddReference(parameters, Path.Combine(apiDir, "TFlexAPIData.dll"));

            foreach (Assembly assembly in AppDomain.CurrentDomain.GetAssemblies())
            {
                try
                {
                    if (!assembly.IsDynamic && !string.IsNullOrEmpty(assembly.Location))
                        AddReference(parameters, assembly.Location);
                }
                catch
                {
                }
            }
        }

        private static void AddReference(CompilerParameters parameters, string reference)
        {
            if (string.IsNullOrEmpty(reference))
                return;

            if (reference.IndexOf(Path.DirectorySeparatorChar) >= 0 && !File.Exists(reference))
                return;

            foreach (string existing in parameters.ReferencedAssemblies)
            {
                if (string.Equals(existing, reference, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(ReferenceKey(existing), ReferenceKey(reference), StringComparison.OrdinalIgnoreCase))
                    return;
            }

            parameters.ReferencedAssemblies.Add(reference);
        }

        private static string ReferenceKey(string reference)
        {
            try
            {
                return Path.GetFileNameWithoutExtension(reference);
            }
            catch
            {
                return reference;
            }
        }

        private static Dictionary<string, object> CompileError(CompilerErrorCollection errors)
        {
            var result = new Dictionary<string, object>();
            var items = new List<Dictionary<string, object>>();

            foreach (CompilerError error in errors)
            {
                if (error.IsWarning)
                    continue;

                items.Add(new Dictionary<string, object>
                {
                    { "line", error.Line },
                    { "column", error.Column },
                    { "number", error.ErrorNumber },
                    { "text", error.ErrorText }
                });
            }

            result["ok"] = false;
            result["phase"] = "compile";
            result["errors"] = items;
            return result;
        }

        private static Document RequireActiveDocument()
        {
            Document doc = TFlex.Application.ActiveDocument;
            if (doc == null)
                throw new InvalidOperationException("No active T-FLEX document");
            return doc;
        }

        private static Variable FindVariable(Document doc, string name)
        {
            foreach (Variable variable in doc.GetVariables())
            {
                if (string.Equals(variable.Name, name, StringComparison.OrdinalIgnoreCase))
                    return variable;
            }
            return null;
        }

        private static Variable CreateVariable(Document doc, string name, object value, string mode)
        {
            if (mode == "real" || (mode == "auto" && IsNumeric(value)))
                return new Variable(doc, name, ToDouble(value));

            return new Variable(doc, name, Convert.ToString(value, CultureInfo.InvariantCulture));
        }

        private static void ApplyValue(Variable variable, object value, string mode)
        {
            if (mode == "real" || (mode == "auto" && variable.IsReal && IsNumeric(value)))
                variable.RealValue = ToDouble(value);
            else if (mode == "text" || (mode == "auto" && variable.IsText))
                variable.TextValue = Convert.ToString(value, CultureInfo.InvariantCulture);
            else
                variable.Expression = Convert.ToString(value, CultureInfo.InvariantCulture);
        }

        private static void TryRebuild(Document doc, bool full)
        {
            try
            {
                doc.Regenerate3D();
                return;
            }
            catch
            {
            }

            MethodInfo method = doc.GetType().GetMethod("Regenerate", Type.EmptyTypes);
            if (method != null)
            {
                method.Invoke(doc, null);
                return;
            }

            if (full)
            {
                method = doc.GetType().GetMethod("RegenerateModelTree", Type.EmptyTypes);
                if (method != null)
                    method.Invoke(doc, null);
            }
        }

        private static void TryCancelChanges(Document doc)
        {
            MethodInfo method = doc.GetType().GetMethod("CancelChanges", Type.EmptyTypes);
            if (method != null)
                method.Invoke(doc, null);
        }

        private static Dictionary<string, object> DocumentInfo(Document doc)
        {
            var info = new Dictionary<string, object>();
            info["type"] = doc.GetType().FullName;
            AddProperty(info, doc, "Name");
            AddProperty(info, doc, "Title");
            AddProperty(info, doc, "FileName");
            AddProperty(info, doc, "FullFileName");
            AddProperty(info, doc, "FilePath");
            AddProperty(info, doc, "Modified");
            return info;
        }

        private static Dictionary<string, object> VariableInfo(Variable variable)
        {
            var info = new Dictionary<string, object>();
            info["name"] = variable.Name;
            info["expression"] = variable.Expression;
            info["isText"] = variable.IsText;
            info["isReal"] = variable.IsReal;
            info["hidden"] = variable.Hidden;
            info["service"] = variable.Service;
            info["external"] = variable.External;
            info["comment"] = variable.Comment;
            info["group"] = variable.GroupName;
            info["error"] = variable.ErrorString;
            if (variable.IsText)
                info["value"] = variable.TextValue;
            if (variable.IsReal)
                info["value"] = variable.RealValue;
            return info;
        }

        private static void AddProperty(Dictionary<string, object> target, object source, string name)
        {
            PropertyInfo property = source.GetType().GetProperty(name);
            if (property == null)
                return;

            try
            {
                object value = property.GetValue(source, null);
                if (value == null || value is string || value.GetType().IsPrimitive)
                    target[name] = value;
                else
                    target[name] = value.ToString();
            }
            catch
            {
            }
        }

        private static Dictionary<string, object> Ok(string key, object value)
        {
            return new Dictionary<string, object> { { "ok", true }, { key, value } };
        }

        private static Dictionary<string, object> Error(string phase, string message, string type, string stack)
        {
            var result = new Dictionary<string, object>();
            result["ok"] = false;
            result["phase"] = phase;
            result["error"] = message;
            result["type"] = type;
            if (!string.IsNullOrEmpty(stack))
                result["stack"] = stack;
            return result;
        }

        private static string RequireString(Dictionary<string, object> args, string name)
        {
            if (!args.ContainsKey(name) || args[name] == null)
                throw new ArgumentException("Missing argument: " + name);
            return Convert.ToString(args[name], CultureInfo.InvariantCulture);
        }

        private static string ArgString(Dictionary<string, object> args, string name, string defaultValue)
        {
            return args.ContainsKey(name) && args[name] != null
                ? Convert.ToString(args[name], CultureInfo.InvariantCulture)
                : defaultValue;
        }

        private static bool ArgBool(Dictionary<string, object> args, string name, bool defaultValue)
        {
            if (!args.ContainsKey(name) || args[name] == null)
                return defaultValue;
            return Convert.ToBoolean(args[name], CultureInfo.InvariantCulture);
        }

        private static Dictionary<string, object> ArgDictionary(Dictionary<string, object> args, string name)
        {
            if (!args.ContainsKey(name) || args[name] == null)
                return new Dictionary<string, object>();

            var typed = args[name] as Dictionary<string, object>;
            if (typed != null)
                return typed;

            var dictionary = args[name] as IDictionary;
            if (dictionary == null)
                throw new ArgumentException("Argument must be an object: " + name);

            var result = new Dictionary<string, object>();
            foreach (DictionaryEntry entry in dictionary)
                result[Convert.ToString(entry.Key, CultureInfo.InvariantCulture)] = entry.Value;
            return result;
        }

        private static bool IsNumeric(object value)
        {
            if (value == null)
                return false;
            double number;
            return double.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture), NumberStyles.Any, CultureInfo.InvariantCulture, out number);
        }

        private static double ToDouble(object value)
        {
            return Convert.ToDouble(value, CultureInfo.InvariantCulture);
        }

        private static void EnsureParent(string filePath)
        {
            string parent = Path.GetDirectoryName(filePath);
            if (!string.IsNullOrEmpty(parent) && !Directory.Exists(parent))
                Directory.CreateDirectory(parent);
        }

        private static object NormalizeForJson(object value, int depth)
        {
            if (value == null)
                return null;

            if (depth > 6)
                return new Dictionary<string, object>
                {
                    { "type", value.GetType().FullName },
                    { "text", Convert.ToString(value, CultureInfo.InvariantCulture) }
                };

            Type type = value.GetType();
            if (value is string || value is bool || type.IsPrimitive || value is decimal)
                return value;

            if (value is DateTime)
                return ((DateTime)value).ToString("o", CultureInfo.InvariantCulture);

            if (type.IsEnum)
                return value.ToString();

            var dictionary = value as IDictionary;
            if (dictionary != null)
            {
                var result = new Dictionary<string, object>();
                int count = 0;
                foreach (DictionaryEntry entry in dictionary)
                {
                    if (count++ >= 500)
                    {
                        result["__truncated"] = true;
                        break;
                    }
                    string key = Convert.ToString(entry.Key, CultureInfo.InvariantCulture);
                    result[key] = NormalizeForJson(entry.Value, depth + 1);
                }
                return result;
            }

            var enumerable = value as IEnumerable;
            if (enumerable != null)
            {
                var result = new List<object>();
                int count = 0;
                foreach (object item in enumerable)
                {
                    if (count++ >= 500)
                    {
                        result.Add(new Dictionary<string, object> { { "__truncated", true } });
                        break;
                    }
                    result.Add(NormalizeForJson(item, depth + 1));
                }
                return result;
            }

            return new Dictionary<string, object>
            {
                { "type", type.FullName },
                { "text", Convert.ToString(value, CultureInfo.InvariantCulture) }
            };
        }
    }
}
